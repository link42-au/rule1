"""Generate and validate the reviewed ISM-to-ATT&CK mitigation assessment cache."""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .annotations import bounded_http_error_body, load_cache as load_annotation_cache
from .attack import ATTACK_VERSION, ISM_VERSION, parse_attack_bundle
from .parsers import build_all_histories

FORMAT_VERSION = 1
PROMPT_VERSION = "ism-attack-mitigation-v3"
MODEL = "minimax/minimax-m3:free"
REASONING = {"effort": "medium", "exclude": True}
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
EXPECTED_CONTROL_COUNT = 1_143
EXPECTED_MITIGATION_COUNT = 44
SHARD_COUNT = 8
DEFAULT_BATCH_SIZE = 20
RELATIONSHIP = "enables"
DISPOSITIONS = frozenset({"mapped", "unmapped"})
SECURITY_FUNCTIONS = frozenset({"protect", "detect", "recover"})
CONFIDENCES = frozenset({"low", "medium", "high"})
STATUSES = frozenset({"candidate", "reviewed", "rejected"})
TECHNIQUE_ID_RE = re.compile(r"(?<![A-Za-z0-9])T\d{4}(?:\.\d{3})?(?![A-Za-z0-9])", re.IGNORECASE)
MITIGATION_ID_RE = re.compile(r"(?<![A-Za-z0-9])M\d{4}(?![A-Za-z0-9])", re.IGNORECASE)
WORD_RE = re.compile(r"[a-z0-9]{4,}", re.IGNORECASE)
MAX_BASIS_LENGTH = 320
MIN_BASIS_LENGTH = 8
CANARY_CONTROL_IDS = (
    "ism-0027", "ism-0109", "ism-0123", "ism-0125", "ism-0133", "ism-1511", "ism-1547",
)
CANARY_REQUIRED_EDGES = frozenset({
    ("ism-0109", "M1047", "detect"),
    ("ism-1511", "M1053", "recover"),
    ("ism-1547", "M1053", "recover"),
})
CANARY_ALLOWED_EDGES = CANARY_REQUIRED_EDGES | frozenset({
    ("ism-0133", "M1022", "protect"),
})
GENERIC_RATIONALES = {
    "this control enables this mitigation",
    "the control supports the mitigation",
    "this is relevant to the mitigation",
}
BASIS_GENERIC_WORDS = frozenset({
    "attack", "control", "controls", "enterprise", "information", "mitigation", "mitigations",
    "requirement", "requirements", "security", "system", "systems",
})

SYSTEM_PROMPT = """Assess Australian ISM controls only against the supplied Enterprise ATT&CK mitigations.
Default to unmapped. Return a mapped assessment only when implementing the control itself directly establishes
or operates the named mitigation through a clear causal mechanism.
A control requiring a specifically named security process or capability to be implemented and maintained can
directly enable the identically matching
mitigation. Distinguish that implementation requirement from documentation, planning, or governance alone.
Governance, documentation, incident context, possible future action, or a shared security goal are not sufficient;
section-topic proximity or an inferred downstream activity are also insufficient. The control statement is authoritative:
section hierarchy and overview material provide context
but must not override or broaden it. Do not invent facts, technologies, processes, effects, or implementation
steps. Do not author, infer, mention, or return ATT&CK technique identifiers or technique fields.

For each defensible mapping choose one security function: protect (prevent or constrain compromise), detect
(identify activity or compromise), or recover (restore capability or reduce consequences after compromise).
Use Australian English. The rationale must explain the direct control-specific causal mechanism and its
connection to the named mitigation, not a generic security benefit. Return a short control_basis excerpt drawn
verbatim apart from whitespace from the control statement, factual annotation, or a section overview. Return a
short mitigation_basis excerpt drawn verbatim apart from whitespace from the named mitigation description. Do
not use the section context as the sole basis for a mapping. If no supplied mitigation is defensible, return
unmapped with a specific control-grounded reason. Return every requested control exactly once and no additional
keys."""

def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _required_text(value: object, context: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{context} must be non-empty text")
    return value.strip()


def _normalise_whitespace(value: str) -> str:
    return " ".join(value.split())


def _canonical_basis(value: str, context: str) -> str:
    source = _normalise_whitespace(_required_text(value, context))
    excerpt = source[:MAX_BASIS_LENGTH].rstrip()
    if len(excerpt) < MIN_BASIS_LENGTH:
        raise ValueError(f"{context} is too short for canonical evidence")
    return excerpt


def _canonical_or_exact_basis(value: object, sources: list[str], context: str) -> str:
    """Keep exact excerpts, or resolve a grounded paraphrase to canonical source text."""
    proposed = _normalise_whitespace(_required_text(value, context))
    if not MIN_BASIS_LENGTH <= len(proposed) <= MAX_BASIS_LENGTH:
        raise ValueError(f"{context} must be a short excerpt")
    available = [_normalise_whitespace(source) for source in sources if source.strip()]
    for source in available:
        if proposed in source:
            return proposed
    proposed_words = _words(proposed) - BASIS_GENERIC_WORDS
    ranked = sorted(
        (
            (len(proposed_words & (_words(source) - BASIS_GENERIC_WORDS)), -index, source)
            for index, source in enumerate(available)
        ),
        reverse=True,
    )
    if not ranked or ranked[0][0] < 2:
        raise ValueError(f"{context} is not grounded in a supplied source")
    return _canonical_basis(ranked[0][2], context)


def _assert_no_techniques(value: object, context: str = "assessment cache") -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if "technique" in str(key).lower():
                raise ValueError(f"{context} contains forbidden technique key: {key}")
            _assert_no_techniques(item, context)
    elif isinstance(value, list):
        for item in value:
            _assert_no_techniques(item, context)
    elif isinstance(value, str) and TECHNIQUE_ID_RE.search(value):
        raise ValueError(f"{context} contains a forbidden ATT&CK technique ID")


def _source_ledger(root: Path) -> list[dict[str, Any]]:
    payload = json.loads((root / "data/source-ledger.json").read_text(encoding="utf-8"))
    sources = payload.get("sources") if isinstance(payload, dict) else None
    if not isinstance(sources, list):
        raise ValueError("source ledger has no sources list")
    return sources


def _group_hierarchy(group_id: str, groups: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    hierarchy: list[dict[str, str]] = []
    seen: set[str] = set()
    current: str | None = group_id
    while current:
        if current in seen:
            raise ValueError(f"ISM group hierarchy contains a cycle at {current}")
        seen.add(current)
        group = groups.get(current)
        if group is None:
            raise ValueError(f"ISM control refers to unknown group {current}")
        hierarchy.append({
            "id": _required_text(group.get("id"), "group id"),
            "title": _required_text(group.get("title"), f"group {current} title"),
            "overview": str(group.get("overview") or ""),
        })
        parent = group.get("parent_id")
        current = str(parent) if parent else None
    return list(reversed(hierarchy))


def load_inputs(root: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Load deterministic prompt inputs without depending on a built SQLite database."""
    root = root.resolve()
    snapshots = [
        item for item in build_all_histories(root)
        if item.get("framework") == "ism" and item.get("catalog_version") == ISM_VERSION
    ]
    if len(snapshots) != 1:
        raise ValueError(f"expected one pinned ISM snapshot {ISM_VERSION}, found {len(snapshots)}")
    snapshot = snapshots[0]
    groups = {str(item.get("id")): item for item in snapshot.get("groups", [])}
    annotations = {
        row["control_id"]: row
        for row in load_annotation_cache(root / "annotations/ism.json")["annotations"]
        if row.get("framework") == "ism" and row.get("catalog_version") == ISM_VERSION
    }
    controls: list[dict[str, Any]] = []
    for control_id, raw in sorted(snapshot.get("controls", {}).items()):
        if raw.get("control_class") != "ISM-control" or raw.get("change_type") == "withdrawn":
            continue
        statement = _required_text(raw.get("statement"), f"{control_id} statement")
        annotation = annotations.get(control_id)
        if annotation is None:
            raise ValueError(f"current factual annotation is missing for {control_id}")
        controls.append({
            "control_id": control_id,
            "display_id": str(raw.get("display_id") or control_id.upper()),
            "catalog_version": ISM_VERSION,
            "statement": statement,
            "section_hierarchy": _group_hierarchy(str(raw.get("section_id") or ""), groups),
            "factual_annotation": _required_text(annotation.get("ai_view"), f"{control_id} factual annotation"),
        })
    if len(controls) != EXPECTED_CONTROL_COUNT:
        raise ValueError(f"expected {EXPECTED_CONTROL_COUNT} active ISM controls, found {len(controls)}")

    attack_sources = [
        item for item in _source_ledger(root)
        if item.get("framework") == "mitre-attack-enterprise" and item.get("version") == ATTACK_VERSION
    ]
    if len(attack_sources) != 1:
        raise ValueError(f"expected one pinned ATT&CK {ATTACK_VERSION} source, found {len(attack_sources)}")
    catalog = parse_attack_bundle(root / str(attack_sources[0]["path"]))
    mitigations = [{
        "mitigation_id": item["mitigation_id"],
        "name": item["name"],
        "description": item["description"],
        "attack_version": ATTACK_VERSION,
    } for item in catalog["mitigations"]]
    mitigations.sort(key=lambda item: item["mitigation_id"])
    if len(mitigations) != EXPECTED_MITIGATION_COUNT:
        raise ValueError(f"expected {EXPECTED_MITIGATION_COUNT} active ATT&CK mitigations, found {len(mitigations)}")
    _assert_no_techniques({"controls": controls, "mitigations": mitigations}, "authored model input")
    return controls, mitigations


def input_sha256(control: dict[str, Any], mitigations: list[dict[str, Any]]) -> str:
    material = {
        "model": MODEL,
        "reasoning": REASONING,
        "prompt_version": PROMPT_VERSION,
        "system_prompt": SYSTEM_PROMPT,
        "control": control,
        "mitigations": mitigations,
    }
    return hashlib.sha256(canonical_json(material).encode()).hexdigest()


def candidate_id(control_id: str, mitigation_id: str) -> str:
    material = f"ism|{ISM_VERSION}|{control_id}|{ATTACK_VERSION}|{mitigation_id}|{RELATIONSHIP}"
    return f"ism-mitigation-{hashlib.sha256(material.encode()).hexdigest()[:20]}"


def empty_cache() -> dict[str, Any]:
    return {
        "format_version": FORMAT_VERSION,
        "ism_catalog_version": ISM_VERSION,
        "attack_version": ATTACK_VERSION,
        "model": MODEL,
        "prompt_version": PROMPT_VERSION,
        "assessments": [],
    }


def read_cache(path: Path) -> dict[str, Any]:
    if not path.exists():
        return empty_cache()
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("mitigation assessment cache must be a JSON object")
    return payload


def write_cache(path: Path, payload: dict[str, Any]) -> None:
    stable = empty_cache()
    stable["assessments"] = sorted(payload.get("assessments", []), key=lambda row: row["control_id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(stable, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _words(value: str) -> set[str]:
    stop = {"that", "this", "with", "from", "into", "their", "they", "must", "should", "where"}
    return {word.lower() for word in WORD_RE.findall(value) if word.lower() not in stop}


def _specific_text(value: object, sources: list[str], context: str, minimum: int) -> str:
    text = _required_text(value, context)
    if len(text) < minimum or text[-1] not in ".!?":
        raise ValueError(f"{context} is incomplete")
    normalised = " ".join(text.lower().split()).rstrip(".!?")
    if normalised in GENERIC_RATIONALES:
        raise ValueError(f"{context} is generic")
    source_words = set().union(*(_words(source) for source in sources))
    if len(_words(text) & source_words) < 2:
        raise ValueError(f"{context} is not grounded in its control and mitigation")
    return text


def _validate_top_level(payload: dict[str, Any]) -> None:
    expected = {
        "format_version": FORMAT_VERSION,
        "ism_catalog_version": ISM_VERSION,
        "attack_version": ATTACK_VERSION,
        "model": MODEL,
        "prompt_version": PROMPT_VERSION,
    }
    allowed = {*expected, "assessments"}
    if set(payload) != allowed:
        raise ValueError("mitigation assessment cache has an unexpected top-level shape")
    for key, value in expected.items():
        if payload.get(key) != value:
            raise ValueError(f"mitigation assessment cache {key} must be {value}")
    if not isinstance(payload.get("assessments"), list):
        raise ValueError("mitigation assessment cache assessments must be a list")


def _normalise_candidate(
    raw: object,
    control: dict[str, Any],
    mitigations: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError(f"{control['control_id']} candidate must be an object")
    expected = {
        "candidate_id", "mitigation_id", "relationship", "security_function", "confidence",
        "rationale", "evidence", "status", "reviewed_by", "reviewed_at",
    }
    if set(raw) != expected:
        raise ValueError(f"{control['control_id']} candidate has an unexpected shape")
    mitigation_id = _required_text(raw.get("mitigation_id"), "candidate mitigation_id")
    mitigation = mitigations.get(mitigation_id)
    if mitigation is None:
        raise ValueError(f"unknown ATT&CK mitigation: {mitigation_id}")
    if raw.get("candidate_id") != candidate_id(control["control_id"], mitigation_id):
        raise ValueError(f"unstable candidate ID for {control['control_id']}/{mitigation_id}")
    if raw.get("relationship") != RELATIONSHIP:
        raise ValueError("control-to-mitigation relationship must be enables")
    if raw.get("security_function") not in SECURITY_FUNCTIONS:
        raise ValueError("invalid security function")
    if raw.get("confidence") not in CONFIDENCES:
        raise ValueError("invalid mapping confidence")
    status = raw.get("status")
    if status not in STATUSES:
        raise ValueError("invalid mapping lifecycle status")
    if status == "candidate" and (raw.get("reviewed_by") is not None or raw.get("reviewed_at") is not None):
        raise ValueError("AI candidate must not contain review metadata")
    if status in {"reviewed", "rejected"}:
        _required_text(raw.get("reviewed_by"), "reviewed_by")
        _required_text(raw.get("reviewed_at"), "reviewed_at")
    rationale = _specific_text(
        raw.get("rationale"),
        [control["statement"], mitigation["name"], mitigation["description"]],
        f"{control['control_id']}/{mitigation_id} rationale",
        60,
    )
    mentioned_mitigations = {value.upper() for value in MITIGATION_ID_RE.findall(rationale)}
    wrong_mitigations = mentioned_mitigations - {mitigation_id.upper()}
    if wrong_mitigations:
        raise ValueError(
            f"{control['control_id']}/{mitigation_id} rationale mentions a different mitigation: "
            f"{', '.join(sorted(wrong_mitigations))}"
        )
    rationale_words = _words(rationale)
    if len(rationale_words & _words(control["statement"])) < 2:
        raise ValueError(f"{control['control_id']}/{mitigation_id} rationale lacks control-specific explanation")
    if len(rationale_words & _words(mitigation["description"])) < 2:
        raise ValueError(f"{control['control_id']}/{mitigation_id} rationale lacks mitigation-specific explanation")
    expected_evidence = [
        {
            "kind": "ism-control",
            "control_id": control["control_id"],
            "catalog_version": ISM_VERSION,
            "statement": control["statement"],
            "section_hierarchy": control["section_hierarchy"],
            "factual_annotation": control["factual_annotation"],
            "matched_text": None,
        },
        {
            "kind": "attack-mitigation",
            "mitigation_id": mitigation_id,
            "attack_version": ATTACK_VERSION,
            "name": mitigation["name"],
            "description": mitigation["description"],
            "matched_text": None,
        },
    ]
    evidence = raw.get("evidence")
    if not isinstance(evidence, list) or len(evidence) != 2:
        raise ValueError(f"{control['control_id']}/{mitigation_id} evidence is incomplete")
    normalised_evidence: list[dict[str, Any]] = []
    for actual, expected_snapshot in zip(evidence, expected_evidence, strict=True):
        if not isinstance(actual, dict) or set(actual) != set(expected_snapshot):
            raise ValueError(f"{control['control_id']}/{mitigation_id} evidence has an unexpected shape")
        matched = _normalise_whitespace(_required_text(actual.get("matched_text"), "matched evidence"))
        if actual.get("kind") == "ism-control":
            searchable = [
                expected_snapshot["statement"],
                expected_snapshot["factual_annotation"],
                *(group["overview"] for group in expected_snapshot["section_hierarchy"]),
            ]
        else:
            searchable = [expected_snapshot["description"]]
        if len(matched) > MAX_BASIS_LENGTH or not any(
            matched in _normalise_whitespace(snapshot) for snapshot in searchable if snapshot.strip()
        ):
            raise ValueError(f"{control['control_id']}/{mitigation_id} matched evidence is not exact")
        expected_snapshot["matched_text"] = matched
        normalised_actual = {**actual, "matched_text": matched}
        if normalised_actual != expected_snapshot:
            raise ValueError(f"{control['control_id']}/{mitigation_id} evidence snapshot is stale")
        normalised_evidence.append(normalised_actual)
    return {**raw, "rationale": rationale, "evidence": normalised_evidence}


def load_assessments(
    path: Path,
    control_contexts: list[dict[str, Any]],
    mitigations: list[dict[str, Any]],
    *,
    require_complete: bool = True,
) -> dict[str, Any]:
    """Return a validated, canonical cache payload for ingestion."""
    payload = read_cache(path)
    _validate_top_level(payload)
    _assert_no_techniques(payload)
    control_by_id = {row["control_id"]: row for row in control_contexts}
    mitigation_by_id = {row["mitigation_id"]: row for row in mitigations}
    seen_controls: set[str] = set()
    seen_candidates: set[str] = set()
    normalised: list[dict[str, Any]] = []
    for raw in payload["assessments"]:
        if not isinstance(raw, dict) or set(raw) != {
            "control_id", "disposition", "unmapped_reason", "candidates", "provenance"
        }:
            raise ValueError("assessment has an unexpected shape")
        control_id = _required_text(raw.get("control_id"), "assessment control_id")
        control = control_by_id.get(control_id)
        if control is None:
            raise ValueError(f"stale or unknown assessed control: {control_id}")
        if control_id in seen_controls:
            raise ValueError(f"duplicate control assessment: {control_id}")
        seen_controls.add(control_id)
        disposition = raw.get("disposition")
        if disposition not in DISPOSITIONS:
            raise ValueError(f"invalid disposition for {control_id}")
        provenance = raw.get("provenance")
        if not isinstance(provenance, dict) or set(provenance) != {
            "ism_catalog_version", "attack_version", "model", "prompt_version", "input_sha256", "generated_at"
        }:
            raise ValueError(f"{control_id} provenance has an unexpected shape")
        expected_provenance = {
            "ism_catalog_version": ISM_VERSION,
            "attack_version": ATTACK_VERSION,
            "model": MODEL,
            "prompt_version": PROMPT_VERSION,
            "input_sha256": input_sha256(control, mitigations),
        }
        for key, value in expected_provenance.items():
            if provenance.get(key) != value:
                raise ValueError(f"{control_id} provenance {key} is stale or invalid")
        generated_at = _required_text(provenance.get("generated_at"), f"{control_id} generated_at")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", generated_at):
            raise ValueError(f"{control_id} generated_at must be a canonical UTC second-precision timestamp")
        try:
            parsed_time = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError(f"{control_id} generated_at is not ISO 8601") from error
        if parsed_time.tzinfo is None or parsed_time.utcoffset() != UTC.utcoffset(parsed_time):
            raise ValueError(f"{control_id} generated_at must be UTC")
        candidates = raw.get("candidates")
        if not isinstance(candidates, list):
            raise ValueError(f"{control_id} candidates must be a list")
        rows = [_normalise_candidate(item, control, mitigation_by_id) for item in candidates]
        ids = [row["candidate_id"] for row in rows]
        mitigation_ids = [row["mitigation_id"] for row in rows]
        if len(ids) != len(set(ids)) or len(mitigation_ids) != len(set(mitigation_ids)):
            raise ValueError(f"{control_id} has duplicate mitigation candidates")
        duplicate_global = set(ids) & seen_candidates
        if duplicate_global:
            raise ValueError(f"duplicate candidate ID: {sorted(duplicate_global)[0]}")
        seen_candidates.update(ids)
        if disposition == "mapped":
            if not rows or raw.get("unmapped_reason") is not None:
                raise ValueError(f"mapped assessment {control_id} has an incomplete partition")
        else:
            if rows:
                raise ValueError(f"unmapped assessment {control_id} must have zero candidates")
            _specific_text(
                raw.get("unmapped_reason"), [control["statement"], control["factual_annotation"]],
                f"{control_id} unmapped reason", 45,
            )
        normalised.append({**raw, "candidates": sorted(rows, key=lambda row: row["mitigation_id"])})
    missing = set(control_by_id) - seen_controls
    if require_complete and missing:
        raise ValueError(f"assessment partition is incomplete: {len(missing)} controls missing")
    if require_complete and len(seen_controls) != EXPECTED_CONTROL_COUNT:
        raise ValueError(f"expected {EXPECTED_CONTROL_COUNT} assessed controls, found {len(seen_controls)}")
    return {**payload, "assessments": sorted(normalised, key=lambda row: row["control_id"])}


def _tool_schema(mitigation_ids: list[str], control_ids: list[str]) -> dict[str, Any]:
    candidate = {
        "type": "object",
        "properties": {
            "mitigation_id": {"type": "string", "enum": mitigation_ids},
            "security_function": {"type": "string", "enum": sorted(SECURITY_FUNCTIONS)},
            "confidence": {"type": "string", "enum": sorted(CONFIDENCES)},
            "rationale": {"type": "string"},
            "control_basis": {
                "type": "string", "minLength": MIN_BASIS_LENGTH, "maxLength": MAX_BASIS_LENGTH,
            },
            "mitigation_basis": {
                "type": "string", "minLength": MIN_BASIS_LENGTH, "maxLength": MAX_BASIS_LENGTH,
            },
        },
        "required": [
            "mitigation_id", "security_function", "confidence", "rationale",
            "control_basis", "mitigation_basis",
        ],
        "additionalProperties": False,
    }
    assessment = {
        "type": "object",
        "properties": {
            "control_id": {"type": "string", "enum": control_ids},
            "disposition": {"type": "string", "enum": sorted(DISPOSITIONS)},
            "unmapped_reason": {"type": ["string", "null"]},
            "candidates": {"type": "array", "items": candidate},
        },
        "required": ["control_id", "disposition", "unmapped_reason", "candidates"],
        "additionalProperties": False,
    }
    return {
        "type": "function",
        "function": {
            "name": "submit_mitigation_assessments",
            "description": "Submit complete control-to-mitigation assessments.",
            "parameters": {
                "type": "object",
                "properties": {"assessments": {
                    "type": "array", "items": assessment,
                    "minItems": len(control_ids), "maxItems": len(control_ids),
                }},
                "required": ["assessments"],
                "additionalProperties": False,
            },
        },
    }


def batch_prompt(controls: list[dict[str, Any]], mitigations: list[dict[str, Any]]) -> str:
    authored = {"controls": controls, "mitigations": mitigations}
    _assert_no_techniques(authored, "authored model input")
    return f"{SYSTEM_PROMPT}\n\nPinned assessment input:\n{canonical_json(authored)}"


def _extract_arguments(message: object) -> str:
    if not isinstance(message, dict):
        raise ValueError("OpenRouter returned an invalid message")
    calls = message.get("tool_calls")
    if not isinstance(calls, list) or len(calls) != 1:
        raise ValueError("OpenRouter returned an invalid mitigation assessment tool call count")
    function = calls[0].get("function") if isinstance(calls[0], dict) else None
    if not isinstance(function, dict) or function.get("name") != "submit_mitigation_assessments":
        raise ValueError("OpenRouter returned an unexpected mitigation assessment tool call")
    arguments = function.get("arguments")
    if not isinstance(arguments, str) or not arguments.strip():
        raise ValueError("OpenRouter returned empty mitigation assessment arguments")
    return arguments.strip()


def call_openrouter(
    prompt: str, api_key: str, mitigation_ids: list[str], control_ids: list[str], *, attempts: int = 6
) -> str:
    tool = _tool_schema(mitigation_ids, control_ids)
    body = json.dumps({
        "model": MODEL,
        "temperature": 0,
        "max_tokens": 16_000,
        "reasoning": REASONING,
        "provider": {"data_collection": "allow"},
        "tools": [tool],
        "tool_choice": {"type": "function", "function": {"name": "submit_mitigation_assessments"}},
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    request = urllib.request.Request(
        OPENROUTER_URL,
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                payload = json.loads(response.read())
            choices = payload.get("choices") if isinstance(payload, dict) else None
            if not isinstance(choices, list) or len(choices) != 1:
                raise ValueError("OpenRouter response has an invalid choices list")
            return _extract_arguments(choices[0].get("message"))
        except urllib.error.HTTPError as error:
            if error.code in {429, 500, 502, 503, 504} and attempt < attempts - 1:
                retry_after = error.headers.get("Retry-After")
                delay = min(60, int(retry_after)) if retry_after and retry_after.isdigit() else min(60, 2 ** (attempt + 1))
                time.sleep(delay)
                continue
            detail = bounded_http_error_body(error, api_key)
            raise RuntimeError(f"OpenRouter HTTP {error.code}{': ' + detail if detail else ''}") from None
        except urllib.error.URLError:
            if attempt == attempts - 1:
                raise
            time.sleep(min(60, 2 ** (attempt + 1)))
        except (http.client.IncompleteRead, http.client.RemoteDisconnected):
            if attempt == attempts - 1:
                raise
            time.sleep(min(60, 2 ** (attempt + 1)))
    raise RuntimeError("OpenRouter retry loop exhausted")


def _response_rows(
    raw: str,
    controls: list[dict[str, Any]],
    mitigations: list[dict[str, Any]],
    generated_at: str,
) -> list[dict[str, Any]]:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError("OpenRouter mitigation assessment response was not JSON") from error
    _assert_no_techniques(payload, "OpenRouter mitigation assessment response")
    if not isinstance(payload, dict) or set(payload) != {"assessments"} or not isinstance(payload["assessments"], list):
        raise ValueError("OpenRouter mitigation assessment response has an unexpected shape")
    by_control = {row["control_id"]: row for row in controls}
    mitigations_by_id = {row["mitigation_id"]: row for row in mitigations}
    found: dict[str, dict[str, Any]] = {}
    for response in payload["assessments"]:
        required_assessment = {"control_id", "disposition", "unmapped_reason", "candidates"}
        if not isinstance(response, dict) or not required_assessment.issubset(response):
            raise ValueError("OpenRouter assessment has an unexpected shape")
        control_id = response.get("control_id")
        if not isinstance(control_id, str) or control_id not in by_control or control_id in found:
            raise ValueError(f"OpenRouter returned unexpected or duplicate control ID: {control_id}")
        control = by_control[control_id]
        candidates = response.get("candidates")
        if not isinstance(candidates, list):
            raise ValueError(f"OpenRouter candidates must be a list for {control_id}")
        expanded = []
        for item in candidates:
            required_candidate = {
                "mitigation_id", "security_function", "confidence", "rationale",
                "control_basis", "mitigation_basis",
            }
            if not isinstance(item, dict) or not required_candidate.issubset(item):
                raise ValueError(f"OpenRouter candidate has an unexpected shape for {control_id}")
            mitigation = mitigations_by_id.get(item.get("mitigation_id"))
            if mitigation is None:
                raise ValueError(f"OpenRouter returned unknown mitigation for {control_id}")
            control_sources = [
                control["statement"],
                control["factual_annotation"],
                *(group["overview"] for group in control["section_hierarchy"]),
            ]
            control_basis = _canonical_or_exact_basis(
                item["control_basis"], control_sources, f"{control_id} control_basis"
            )
            mitigation_basis = _canonical_or_exact_basis(
                item["mitigation_basis"], [mitigation["description"]],
                f"{control_id}/{mitigation['mitigation_id']} mitigation_basis",
            )
            expanded.append({
                "candidate_id": candidate_id(control_id, mitigation["mitigation_id"]),
                "mitigation_id": mitigation["mitigation_id"],
                "relationship": RELATIONSHIP,
                "security_function": item["security_function"],
                "confidence": item["confidence"],
                "rationale": item["rationale"],
                "evidence": [{
                    "kind": "ism-control", "control_id": control_id,
                    "catalog_version": ISM_VERSION, "statement": control["statement"],
                    "section_hierarchy": control["section_hierarchy"],
                    "factual_annotation": control["factual_annotation"],
                    "matched_text": control_basis,
                }, {
                    "kind": "attack-mitigation", "mitigation_id": mitigation["mitigation_id"],
                    "attack_version": ATTACK_VERSION, "name": mitigation["name"],
                    "description": mitigation["description"],
                    "matched_text": mitigation_basis,
                }],
                "status": "candidate", "reviewed_by": None, "reviewed_at": None,
            })
        found[control_id] = {
            "control_id": control_id,
            "disposition": response["disposition"],
            "unmapped_reason": response["unmapped_reason"],
            "candidates": expanded,
            "provenance": {
                "ism_catalog_version": ISM_VERSION, "attack_version": ATTACK_VERSION,
                "model": MODEL, "prompt_version": PROMPT_VERSION,
                "input_sha256": input_sha256(control, mitigations), "generated_at": generated_at,
            },
        }
    missing = set(by_control) - set(found)
    if missing:
        raise ValueError(f"OpenRouter omitted requested controls: {', '.join(sorted(missing))}")
    candidate_payload = empty_cache()
    candidate_payload["assessments"] = list(found.values())
    with _temporary_payload(candidate_payload) as temporary:
        return load_assessments(temporary, controls, mitigations, require_complete=False)["assessments"]


def generate_batch(
    controls: list[dict[str, Any]],
    mitigations: list[dict[str, Any]],
    api_key: str,
    *,
    attempts: int = 4,
) -> list[dict[str, Any]]:
    """Retry complete model calls when a successful response fails strict validation."""
    mitigation_ids = [row["mitigation_id"] for row in mitigations]
    last_error: ValueError | None = None
    for attempt in range(attempts):
        try:
            raw = call_openrouter(
                batch_prompt(controls, mitigations), api_key, mitigation_ids,
                [row["control_id"] for row in controls],
            )
            generated_at = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
            return _response_rows(raw, controls, mitigations, generated_at)
        except ValueError as error:
            last_error = error
            if attempt < attempts - 1:
                time.sleep(min(30, 2 ** (attempt + 1)))
    raise ValueError(f"OpenRouter did not return a complete valid mitigation batch: {last_error}")


def generate_with_bisection(
    controls: list[dict[str, Any]],
    mitigations: list[dict[str, Any]],
    api_key: str,
    checkpoint: Callable[[list[dict[str, Any]]], None],
) -> None:
    """Generate a batch, splitting only exhausted validation failures deterministically."""
    try:
        rows = generate_batch(
            controls,
            mitigations,
            api_key,
            attempts=4 if len(controls) == 1 else 1,
        )
    except ValueError:
        if len(controls) == 1:
            raise
        midpoint = len(controls) // 2
        generate_with_bisection(controls[:midpoint], mitigations, api_key, checkpoint)
        generate_with_bisection(controls[midpoint:], mitigations, api_key, checkpoint)
        return
    checkpoint(rows)


def shard_controls(
    controls: list[dict[str, Any]], shard_index: int, shard_count: int = SHARD_COUNT
) -> list[dict[str, Any]]:
    """Return one stable modulo shard of the globally sorted control partition."""
    if shard_count != SHARD_COUNT:
        raise ValueError(f"mitigation generation requires exactly {SHARD_COUNT} shards")
    if not 0 <= shard_index < shard_count:
        raise ValueError(f"shard index must be between 0 and {shard_count - 1}")
    ordered = sorted(controls, key=lambda row: row["control_id"])
    if len({row["control_id"] for row in ordered}) != len(ordered):
        raise ValueError("cannot shard duplicate control IDs")
    return [row for index, row in enumerate(ordered) if index % shard_count == shard_index]


class _temporary_payload:
    """Validate generated rows through the same file-backed public loader."""

    def __init__(self, payload: dict[str, Any]):
        self.payload = payload
        self.path: Path | None = None

    def __enter__(self) -> Path:
        import tempfile

        handle = tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8", delete=False)
        with handle:
            json.dump(self.payload, handle)
        self.path = Path(handle.name)
        return self.path

    def __exit__(self, *_: object) -> None:
        if self.path is not None:
            self.path.unlink(missing_ok=True)


def _valid_generation_rows(
    path: Path,
    controls: list[dict[str, Any]],
    mitigations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Keep individually current rows while treating invalid cache rows as stale."""
    payload = read_cache(path)
    if set(payload) != {
        "format_version", "ism_catalog_version", "attack_version", "model",
        "prompt_version", "assessments",
    }:
        raise ValueError("mitigation assessment cache has an unexpected top-level shape")
    if any(payload.get(key) != value for key, value in {
        "format_version": FORMAT_VERSION,
        "ism_catalog_version": ISM_VERSION,
        "attack_version": ATTACK_VERSION,
        "model": MODEL,
        "prompt_version": PROMPT_VERSION,
    }.items()):
        return []
    _validate_top_level(payload)
    raw_ids = [row.get("control_id") for row in payload["assessments"] if isinstance(row, dict)]
    duplicate_ids = {control_id for control_id in raw_ids if raw_ids.count(control_id) > 1}
    valid: list[dict[str, Any]] = []
    for raw in payload["assessments"]:
        if isinstance(raw, dict) and raw.get("control_id") in duplicate_ids:
            continue
        candidate = empty_cache()
        candidate["assessments"] = [raw]
        with _temporary_payload(candidate) as temporary:
            try:
                row = load_assessments(
                    temporary, controls, mitigations, require_complete=False
                )["assessments"][0]
            except (IndexError, ValueError):
                continue
        valid.append(row)
    return valid


def generate(
    root: Path,
    cache: Path,
    api_key: str,
    batch_size: int,
    *,
    selected_control_ids: tuple[str, ...] | None = None,
    seed_cache: Path | None = None,
) -> tuple[int, int]:
    if not cache.exists():
        write_cache(cache, empty_cache())
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY is required")
    if not 1 <= batch_size <= 25:
        raise ValueError("batch size must be between 1 and 25")
    all_controls, mitigations = load_inputs(root)
    controls = all_controls
    if selected_control_ids is not None:
        control_by_id = {row["control_id"]: row for row in all_controls}
        missing = set(selected_control_ids) - set(control_by_id)
        if missing:
            raise ValueError(f"unknown selected control: {sorted(missing)[0]}")
        controls = [control_by_id[control_id] for control_id in selected_control_ids]
    payload = read_cache(cache)
    if (
        payload.get("format_version") == FORMAT_VERSION
        and payload.get("ism_catalog_version") == ISM_VERSION
        and payload.get("attack_version") == ATTACK_VERSION
        and (payload.get("model") != MODEL or payload.get("prompt_version") != PROMPT_VERSION)
    ):
        payload = empty_cache()
        write_cache(cache, payload)
    stored = {
        row["control_id"]: row
        for row in _valid_generation_rows(cache, all_controls, mitigations)
    }
    selected_ids = {row["control_id"] for row in controls}
    unexpected = set(stored) - selected_ids
    if unexpected:
        raise ValueError(f"generation cache contains control outside its partition: {sorted(unexpected)[0]}")
    if seed_cache is not None and seed_cache.exists():
        for row in _valid_generation_rows(seed_cache, all_controls, mitigations):
            if row["control_id"] in selected_ids and row["control_id"] not in stored:
                stored[row["control_id"]] = row
        payload["assessments"] = list(stored.values())
        write_cache(cache, payload)
    stale = [
        row for row in controls
        if row["control_id"] not in stored
        or stored[row["control_id"]]["provenance"]["input_sha256"] != input_sha256(row, mitigations)
    ]
    generated = 0

    def checkpoint(rows: list[dict[str, Any]]) -> None:
        nonlocal generated
        for row in rows:
            stored[row["control_id"]] = row
        payload["assessments"] = list(stored.values())
        write_cache(cache, payload)
        generated += len(rows)
        print(f"checkpointed {generated}/{len(stale)} mitigation assessments", flush=True)

    for offset in range(0, len(stale), batch_size):
        batch = stale[offset:offset + batch_size]
        generate_with_bisection(batch, mitigations, api_key, checkpoint)
    return generated, len(stale)


def generate_shard(
    root: Path,
    tracked_cache: Path,
    cache: Path,
    api_key: str,
    batch_size: int,
    shard_index: int,
) -> tuple[int, int]:
    """Generate one deterministic shard, resuming valid rows from both caches."""
    if not cache.exists():
        write_cache(cache, empty_cache())
    controls, mitigations = load_inputs(root)
    selected = tuple(row["control_id"] for row in shard_controls(controls, shard_index))
    selected_ids = set(selected)
    stored = {
        row["control_id"]: row
        for row in _valid_generation_rows(cache, controls, mitigations)
    }
    unexpected = set(stored) - selected_ids
    if unexpected:
        raise ValueError(f"generation cache contains control outside its partition: {sorted(unexpected)[0]}")
    if tracked_cache.exists():
        for row in _valid_generation_rows(tracked_cache, controls, mitigations):
            if row["control_id"] in selected_ids and row["control_id"] not in stored:
                stored[row["control_id"]] = row
    payload = empty_cache()
    payload["assessments"] = list(stored.values())
    write_cache(cache, payload)
    return generate(
        root, cache, api_key, batch_size,
        selected_control_ids=selected,
    )


def merge_shards(
    root: Path,
    shard_dir: Path,
    cache: Path,
    *,
    require_complete: bool = True,
) -> dict[str, Any]:
    """Strictly validate and canonically merge deterministic shard caches."""
    controls, mitigations = load_inputs(root)
    combined: list[dict[str, Any]] = []
    seen_controls: set[str] = set()
    seen_candidates: set[str] = set()
    for shard_index in range(SHARD_COUNT):
        path = shard_dir / f"shard-{shard_index}.json"
        if not path.exists():
            if require_complete:
                raise ValueError(f"required mitigation shard is missing: {path.name}")
            continue
        payload = load_assessments(path, controls, mitigations, require_complete=False)
        member_ids = {row["control_id"] for row in shard_controls(controls, shard_index)}
        for assessment in payload["assessments"]:
            control_id = assessment["control_id"]
            if control_id not in member_ids:
                raise ValueError(f"{path.name} contains control from the wrong shard: {control_id}")
            if control_id in seen_controls:
                raise ValueError(f"duplicate control ID across mitigation shards: {control_id}")
            candidate_ids = {row["candidate_id"] for row in assessment["candidates"]}
            duplicate_candidates = candidate_ids & seen_candidates
            if duplicate_candidates:
                raise ValueError(
                    f"duplicate candidate ID across mitigation shards: {sorted(duplicate_candidates)[0]}"
                )
            seen_controls.add(control_id)
            seen_candidates.update(candidate_ids)
            combined.append(assessment)
    payload = empty_cache()
    payload["assessments"] = combined
    with _temporary_payload(payload) as temporary:
        canonical = load_assessments(
            temporary, controls, mitigations, require_complete=require_complete
        )
    write_cache(cache, canonical)
    return canonical


def verify_canary(
    cache: Path,
    controls: list[dict[str, Any]],
    mitigations: list[dict[str, Any]],
) -> dict[str, Any]:
    """Validate the fixed conservative-mapping canary and its expected edge allowlist."""
    payload = load_assessments(cache, controls, mitigations, require_complete=False)
    assessments = payload["assessments"]
    actual_controls = {row["control_id"] for row in assessments}
    expected_controls = set(CANARY_CONTROL_IDS)
    if actual_controls != expected_controls:
        missing = sorted(expected_controls - actual_controls)
        extra = sorted(actual_controls - expected_controls)
        raise ValueError(f"canary control partition mismatch: missing={missing}, extra={extra}")
    edges = {
        (assessment["control_id"], candidate["mitigation_id"], candidate["security_function"])
        for assessment in assessments
        for candidate in assessment["candidates"]
    }
    missing_edges = CANARY_REQUIRED_EDGES - edges
    if missing_edges:
        raise ValueError(f"canary required edge is absent: {sorted(missing_edges)[0]}")
    forbidden_edges = edges - CANARY_ALLOWED_EDGES
    if forbidden_edges:
        raise ValueError(f"canary edge is outside the conservative allowlist: {sorted(forbidden_edges)[0]}")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    generated = subparsers.add_parser("generate")
    generated.add_argument("--root", type=Path, default=Path("."))
    generated.add_argument("--cache", type=Path, default=Path("mappings/ism-attack-mitigation-assessments.json"))
    generated.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    shard_generated = subparsers.add_parser("generate-shard")
    shard_generated.add_argument("--root", type=Path, default=Path("."))
    shard_generated.add_argument(
        "--tracked-cache", type=Path,
        default=Path("mappings/ism-attack-mitigation-assessments.json"),
    )
    shard_generated.add_argument("--cache", type=Path, required=True)
    shard_generated.add_argument("--shard-index", type=int, required=True)
    shard_generated.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    merged = subparsers.add_parser("merge-shards")
    merged.add_argument("--root", type=Path, default=Path("."))
    merged.add_argument("--shard-dir", type=Path, required=True)
    merged.add_argument(
        "--cache", type=Path,
        default=Path("mappings/ism-attack-mitigation-assessments.json"),
    )
    merged.add_argument("--require-complete", action="store_true")
    canary_generated = subparsers.add_parser("generate-canary")
    canary_generated.add_argument("--root", type=Path, default=Path("."))
    canary_generated.add_argument(
        "--cache", type=Path, default=Path("build/ism-attack-mitigation-canary.json")
    )
    canary_generated.add_argument("--batch-size", type=int, default=len(CANARY_CONTROL_IDS))
    canary_checked = subparsers.add_parser("verify-canary")
    canary_checked.add_argument("--root", type=Path, default=Path("."))
    canary_checked.add_argument(
        "--cache", type=Path, default=Path("build/ism-attack-mitigation-canary.json")
    )
    for command in ("check", "validate", "checkpoint"):
        checked = subparsers.add_parser(command)
        checked.add_argument("--root", type=Path, default=Path("."))
        checked.add_argument("--cache", type=Path, default=Path("mappings/ism-attack-mitigation-assessments.json"))
        checked.add_argument("--require-complete", action="store_true")
    args = parser.parse_args()
    try:
        if args.command in {"generate", "generate-canary"}:
            generated_count, stale_count = generate(
                args.root,
                args.cache,
                os.environ.get("OPENROUTER_API_KEY", ""),
                args.batch_size,
                selected_control_ids=CANARY_CONTROL_IDS if args.command == "generate-canary" else None,
            )
            print(f"generated {generated_count} of {stale_count} stale mitigation assessments")
        elif args.command == "generate-shard":
            generated_count, stale_count = generate_shard(
                args.root, args.tracked_cache, args.cache,
                os.environ.get("OPENROUTER_API_KEY", ""), args.batch_size, args.shard_index,
            )
            print(f"generated {generated_count} of {stale_count} stale shard assessments")
        elif args.command == "merge-shards":
            payload = merge_shards(
                args.root, args.shard_dir, args.cache,
                require_complete=args.require_complete,
            )
            print(f"merged {len(payload['assessments'])} mitigation assessments")
        elif args.command == "verify-canary":
            controls, mitigations = load_inputs(args.root)
            payload = verify_canary(args.cache, controls, mitigations)
            edge_count = sum(len(row["candidates"]) for row in payload["assessments"])
            print(f"verified mitigation canary: {len(payload['assessments'])} controls, {edge_count} edges")
        else:
            controls, mitigations = load_inputs(args.root)
            payload = load_assessments(args.cache, controls, mitigations, require_complete=args.require_complete)
            if args.command == "checkpoint":
                write_cache(args.cache, payload)
            mapped = sum(row["disposition"] == "mapped" for row in payload["assessments"])
            total = len(payload["assessments"])
            print(f"mitigation assessment coverage: {total}/{len(controls)} ({mapped} mapped, {total - mapped} unmapped)")
    except (OSError, RuntimeError, ValueError, sqlite3.Error, urllib.error.URLError) as error:
        print(f"mitigation assessment operation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
