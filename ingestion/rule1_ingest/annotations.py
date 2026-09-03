"""Import, generate, and validate deterministic Rule1 annotation cache data."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

FORMAT_VERSION = 1
PROMPT_VERSION = "legacy-rule1-v1"
MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
LEGACY_SOURCE_SHA256 = "405659ce5d393df9a20530f8fa5de0e28f4e2ac47a802d2d36cb196f3d26f2c1"
LEGACY_CORPUS_SHA256 = "19cd479576336c00da4c9db769d386e16795b0da3164b5e1ea6bfd7bb6c75d10"
LEGACY_MANIFEST_SHA256 = "028b45261b4c4db599e6d6c9eae423e4864c4cb16aa9871a84c5378add8bd5b5"

FACTUAL_SYSTEM = (
    "You are writing concise plain-English annotations for the Australian Government's "
    "Information Security Manual (ISM). Your annotations help practitioners quickly "
    "understand what a control requires and why it matters."
)
PROFESSIONAL_SYSTEM = (
    "You are writing dry, sardonic annotations for the Australian Government's "
    "Information Security Manual (ISM). Your annotations are accurate but written with "
    "the weary cynicism of an infosec veteran who has seen organisations ignore this exact "
    "control for the fifteenth time. You are concise, technically correct, and quietly "
    "judgmental. You do not make things up — you just observe reality with a raised eyebrow."
)
CLASSIFICATION_LABELS = {
    "NC": "Not Classified",
    "OS": "OFFICIAL:Sensitive",
    "P": "PROTECTED",
    "S": "SECRET",
    "TS": "TOP SECRET",
}

SUBMIT_ANNOTATIONS_TOOL = {
    "type": "function",
    "function": {
        "name": "submit_annotations",
        "description": "Submit all requested factual and Professional Rule1 annotations.",
        "parameters": {
            "type": "object",
            "properties": {
                "annotations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "control_id": {"type": "string"},
                            "ai_view": {"type": "string"},
                            "ai_view_snarky": {"type": "string"},
                        },
                        "required": ["control_id", "ai_view", "ai_view_snarky"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["annotations"],
            "additionalProperties": False,
        },
    },
}


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _json_list(value: object) -> list[str]:
    if value is None or value == "":
        return []
    parsed = json.loads(value) if isinstance(value, str) else value
    if not isinstance(parsed, list):
        raise ValueError("expected a JSON list")
    return [str(item) for item in parsed]


def load_cache(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "format_version": FORMAT_VERSION,
            "prompt_version": PROMPT_VERSION,
            "model": MODEL,
            "legacy_source_sha256": LEGACY_SOURCE_SHA256,
            "annotations": [],
        }
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("annotation cache must be a JSON object")
    if payload.get("format_version") != FORMAT_VERSION:
        raise ValueError("unsupported annotation cache format")
    if not isinstance(payload.get("annotations"), list):
        raise ValueError("annotation cache annotations must be a list")
    seen: set[tuple[str, str]] = set()
    for row in payload["annotations"]:
        key = (str(row.get("framework", "")), str(row.get("control_id", "")))
        if not all(key) or key in seen:
            raise ValueError(f"duplicate or invalid annotation cache key: {key}")
        seen.add(key)
        for field in ("ai_view", "ai_view_snarky"):
            if not isinstance(row.get(field), str) or not row[field].strip():
                raise ValueError(f"{key} has an empty {field}")
        for field in ("catalog_version", "prompt_version", "model", "updated_at"):
            if not isinstance(row.get(field), str) or not row[field].strip():
                raise ValueError(f"{key} has an empty {field}")
        _json_list(row.get("links", []))
        _json_list(row.get("impls", []))
    return payload


def write_cache(path: Path, payload: dict[str, Any]) -> None:
    annotations = sorted(
        payload["annotations"], key=lambda row: (row["framework"], row["control_id"])
    )
    stable = {
        "format_version": FORMAT_VERSION,
        "prompt_version": PROMPT_VERSION,
        "model": MODEL,
        "legacy_source_sha256": LEGACY_SOURCE_SHA256,
        "annotations": annotations,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(stable, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def description_sha256(row: dict[str, Any]) -> str:
    pair = [row["ai_view"], row["ai_view_snarky"]]
    return hashlib.sha256(canonical_json(pair).encode()).hexdigest()


def write_legacy_manifest(database: Path, cache: Path, manifest: Path) -> int:
    if manifest.exists():
        raise ValueError("legacy preservation manifest already exists")
    controls = {item["control_id"]: item for item in load_current_controls(database)}
    rows = load_cache(cache)["annotations"]
    entries = []
    for row in rows:
        current = controls.get(row["control_id"])
        disposition = "refresh" if current and current["current_change_type"] != "unchanged" else "preserve"
        entries.append({
            "control_id": row["control_id"],
            "description_sha256": description_sha256(row),
            "disposition": disposition,
        })
    payload = {
        "format_version": 1,
        "legacy_source_sha256": LEGACY_SOURCE_SHA256,
        "legacy_corpus_sha256": LEGACY_CORPUS_SHA256,
        "catalog_version": "2025.12.9",
        "row_count": len(entries),
        "preserve_count": sum(row["disposition"] == "preserve" for row in entries),
        "refresh_count": sum(row["disposition"] == "refresh" for row in entries),
        "rows": sorted(entries, key=lambda row: row["control_id"]),
    }
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return len(entries)


def import_legacy(database: Path, cache: Path) -> int:
    with sqlite3.connect(f"file:{database.resolve()}?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT framework, control_id, catalog_version, ai_view, ai_view_snarky, "
            "links, impls, updated_at FROM annotations ORDER BY framework, control_id"
        ).fetchall()
    annotations = []
    for row in rows:
        if not row["ai_view"] or not row["ai_view_snarky"]:
            raise ValueError(f"legacy annotation pair is incomplete: {row['control_id']}")
        annotations.append({
            "framework": row["framework"] or "ism",
            "control_id": row["control_id"],
            "catalog_version": row["catalog_version"] or "",
            "input_sha256": None,
            "prompt_version": PROMPT_VERSION,
            "model": "legacy-provider-unrecorded",
            "ai_view": row["ai_view"],
            "ai_view_snarky": row["ai_view_snarky"],
            "links": _json_list(row["links"]),
            "impls": _json_list(row["impls"]),
            "updated_at": row["updated_at"] or "",
        })
    if len(annotations) != 1_073:
        raise ValueError(f"expected 1073 verified legacy annotations, found {len(annotations)}")
    payload = load_cache(Path("/nonexistent-rule1-cache"))
    payload["annotations"] = annotations
    write_cache(cache, payload)
    return len(annotations)


def _expand_applicability(codes: list[str]) -> str:
    return ", ".join(CLASSIFICATION_LABELS.get(code, code) for code in codes) or "N/A"


def _prompt_input(row: sqlite3.Row, history: list[sqlite3.Row]) -> dict[str, Any]:
    changed = [item for item in history if item["change_type"] not in ("unchanged", None)][:4]
    return {
        "control_id": row["control_id"],
        "display_id": row["display_id"] or row["control_id"],
        "label": row["label"] or "",
        "section": row["section_title"] or "Unknown",
        "guideline": row["guideline"] or "",
        "applicability": _expand_applicability(_json_list(row["applicability"])),
        "e8_levels": ", ".join(_json_list(row["e8_levels"])) or "N/A",
        "statement": row["statement"] or "",
        "changes": [
            {"catalog_version": item["catalog_version"], "change_type": item["change_type"]}
            for item in changed
        ],
        "catalog_version": row["catalog_version"],
        "current_change_type": row["change_type"],
    }


def input_sha256(item: dict[str, Any]) -> str:
    material = {
        "model": MODEL,
        "prompt_version": PROMPT_VERSION,
        "factual_system": FACTUAL_SYSTEM,
        "professional_system": PROFESSIONAL_SYSTEM,
        "input": {key: value for key, value in item.items() if key != "current_change_type"},
    }
    return hashlib.sha256(canonical_json(material).encode()).hexdigest()


def load_current_controls(database: Path) -> list[dict[str, Any]]:
    with sqlite3.connect(f"file:{database.resolve()}?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        latest = connection.execute(
            "SELECT version FROM catalog_versions WHERE framework='ism' ORDER BY ordinal DESC LIMIT 1"
        ).fetchone()
        if latest is None:
            raise ValueError("current ISM catalogue is missing")
        rows = connection.execute(
            "SELECT * FROM control_history WHERE framework='ism' AND catalog_version=? "
            "AND control_class='ISM-control' AND change_type!='withdrawn' ORDER BY ordinal",
            (latest["version"],),
        ).fetchall()
        controls = []
        for row in rows:
            history = connection.execute(
                "SELECT catalog_version, change_type FROM control_history h JOIN catalog_versions v "
                "ON v.framework=h.framework AND v.version=h.catalog_version "
                "WHERE h.framework='ism' AND h.control_id=? ORDER BY v.ordinal DESC",
                (row["control_id"],),
            ).fetchall()
            controls.append(_prompt_input(row, history))
    return controls


def _batch_prompt(items: list[dict[str, Any]]) -> str:
    compact = [
        {key: value for key, value in item.items() if key not in {"catalog_version", "current_change_type"}}
        for item in items
    ]
    return f"""Generate both legacy Rule1 annotation flavours for every control in the JSON input.

Factual style instruction:
{FACTUAL_SYSTEM}
Write a 2–3 sentence plain-English summary explaining what the control requires and why it matters for security. Be concrete and practical. Do not restate the control ID or use unexplained acronyms.

Professional style instruction:
{PROFESSIONAL_SYSTEM}
Write a 2–3 sentence annotation explaining what the control requires, in the voice of a battle-hardened infosec practitioner who finds the whole thing mildly absurd but technically correct. Be accurate but drily sardonic. Do not restate the control ID.

Return only one JSON object with this shape:
{{"annotations":[{{"control_id":"ism-0000","ai_view":"...","ai_view_snarky":"..."}}]}}
Return every requested control exactly once, with no additional IDs or keys. Both strings must be non-empty.

Input:
{canonical_json(compact)}"""


def parse_batch_response(raw: str, expected_ids: list[str]) -> list[dict[str, str]]:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError("OpenRouter response was not JSON") from error
    if not isinstance(payload, dict) or set(payload) != {"annotations"} or not isinstance(payload["annotations"], list):
        raise ValueError("OpenRouter response has an unexpected top-level shape")
    expected = set(expected_ids)
    found: dict[str, dict[str, str]] = {}
    for row in payload["annotations"]:
        if not isinstance(row, dict) or set(row) != {"control_id", "ai_view", "ai_view_snarky"}:
            raise ValueError("OpenRouter annotation row has an unexpected shape")
        control_id = row["control_id"]
        if not isinstance(control_id, str):
            raise ValueError("OpenRouter returned a non-string control ID")
        if control_id not in expected or control_id in found:
            raise ValueError(f"OpenRouter returned an unexpected or duplicate ID: {control_id}")
        if not isinstance(row["ai_view"], str) or not row["ai_view"].strip():
            raise ValueError(f"OpenRouter returned an empty factual description for {control_id}")
        if not isinstance(row["ai_view_snarky"], str) or not row["ai_view_snarky"].strip():
            raise ValueError(f"OpenRouter returned an empty Professional description for {control_id}")
        found[control_id] = row
    if set(found) != expected:
        missing = sorted(expected - set(found))
        raise ValueError(f"OpenRouter omitted requested IDs: {', '.join(missing)}")
    return [found[control_id] for control_id in expected_ids]


def bounded_http_error_body(error: urllib.error.HTTPError, api_key: str = "") -> str:
    try:
        raw = error.read(2_048)
    except (AttributeError, OSError):
        return ""
    text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
    if api_key:
        text = text.replace(api_key, "[redacted]")
    text = re.sub(r"sk-or-v1-[A-Za-z0-9_-]+", "[redacted]", text)
    return " ".join(text.split())[:512]


def extract_annotation_arguments(message: object) -> str:
    if not isinstance(message, dict):
        raise ValueError("OpenRouter returned an invalid message")
    tool_calls = message.get("tool_calls")
    if tool_calls is not None:
        if not isinstance(tool_calls, list) or len(tool_calls) != 1:
            raise ValueError("OpenRouter returned an invalid annotation tool call count")
        call = tool_calls[0]
        function = call.get("function") if isinstance(call, dict) else None
        if not isinstance(function, dict) or function.get("name") != "submit_annotations":
            raise ValueError("OpenRouter returned an unexpected annotation tool call")
        arguments = function.get("arguments")
        if not isinstance(arguments, str) or not arguments.strip():
            raise ValueError("OpenRouter returned empty annotation tool arguments")
        return arguments.strip()
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("OpenRouter returned neither annotation tool arguments nor content")
    return content.strip()


def call_openrouter(prompt: str, api_key: str, *, attempts: int = 6) -> str:
    payload = json.dumps({
        "model": MODEL,
        "temperature": 0,
        "max_tokens": 12_000,
        "provider": {"data_collection": "allow"},
        "tools": [SUBMIT_ANNOTATIONS_TOOL],
        "tool_choice": {"type": "function", "function": {"name": "submit_annotations"}},
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    request = urllib.request.Request(
        OPENROUTER_URL,
        data=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                body = json.loads(response.read())
            choices = body.get("choices") or []
            if not choices:
                raise ValueError("OpenRouter returned no choices")
            return extract_annotation_arguments(choices[0].get("message"))
        except urllib.error.HTTPError as error:
            if error.code in {429, 500, 502, 503, 504} and attempt < attempts - 1:
                retry_after = error.headers.get("Retry-After")
                delay = min(60, int(retry_after)) if retry_after and retry_after.isdigit() else min(60, 2 ** (attempt + 1))
                time.sleep(delay)
                continue
            body = bounded_http_error_body(error, api_key)
            detail = f": {body}" if body else ""
            raise RuntimeError(f"OpenRouter HTTP {error.code}{detail}") from None
        except urllib.error.URLError:
            if attempt == attempts - 1:
                raise
            time.sleep(min(60, 2 ** (attempt + 1)))
    raise RuntimeError("OpenRouter retry loop exhausted")


def generate_batch(items: list[dict[str, Any]], api_key: str, *, attempts: int = 4) -> list[dict[str, str]]:
    expected_ids = [item["control_id"] for item in items]
    last_error: ValueError | None = None
    for attempt in range(attempts):
        try:
            raw = call_openrouter(_batch_prompt(items), api_key)
            return parse_batch_response(raw, expected_ids)
        except ValueError as error:
            last_error = error
            if attempt < attempts - 1:
                time.sleep(min(30, 2 ** (attempt + 1)))
    raise ValueError(f"OpenRouter did not return a complete valid batch: {last_error}")


def prepare_generation(
    controls: list[dict[str, Any]], payload: dict[str, Any]
) -> tuple[dict[tuple[str, str], dict[str, Any]], list[dict[str, Any]], int]:
    stored = {(row["framework"], row["control_id"]): row for row in payload["annotations"]}
    stale: list[dict[str, Any]] = []
    adopted = 0
    for item in controls:
        key = ("ism", item["control_id"])
        row = stored.get(key)
        digest = input_sha256(item)
        if row and row.get("catalog_version") == item["catalog_version"] and row.get("input_sha256") == digest:
            continue
        if row and item["current_change_type"] == "unchanged":
            row["catalog_version"] = item["catalog_version"]
            row["input_sha256"] = digest
            adopted += 1
            continue
        stale.append(item)
    return stored, stale, adopted


def cache_status(database: Path, cache: Path) -> tuple[int, int, int]:
    controls = load_current_controls(database)
    stored = {(row["framework"], row["control_id"]): row for row in load_cache(cache)["annotations"]}
    fresh = 0
    for item in controls:
        row = stored.get(("ism", item["control_id"]))
        if row and row.get("catalog_version") == item["catalog_version"] and row.get("input_sha256") == input_sha256(item):
            fresh += 1
    return len(controls), fresh, len(controls) - fresh


def generate(database: Path, cache: Path, api_key: str, batch_size: int) -> tuple[int, int]:
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY is required")
    if not 1 <= batch_size <= 25:
        raise ValueError("batch size must be between 1 and 25")
    controls = load_current_controls(database)
    payload = load_cache(cache)
    stored, stale, adopted = prepare_generation(controls, payload)
    if len(stale) > 1_250:
        raise ValueError("unexpectedly large annotation generation scope")
    if adopted:
        payload["annotations"] = list(stored.values())
        write_cache(cache, payload)
        print(f"adopted {adopted} unchanged legacy annotation pairs", flush=True)
    generated = 0
    for offset in range(0, len(stale), batch_size):
        batch = stale[offset:offset + batch_size]
        response = generate_batch(batch, api_key)
        timestamp = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        by_id = {item["control_id"]: item for item in batch}
        for result in response:
            item = by_id[result["control_id"]]
            previous = stored.get(("ism", result["control_id"]), {})
            stored[("ism", result["control_id"])] = {
                "framework": "ism",
                "control_id": result["control_id"],
                "catalog_version": item["catalog_version"],
                "input_sha256": input_sha256(item),
                "prompt_version": PROMPT_VERSION,
                "model": MODEL,
                "ai_view": result["ai_view"].strip(),
                "ai_view_snarky": result["ai_view_snarky"].strip(),
                "links": previous.get("links", []),
                "impls": previous.get("impls", []),
                "updated_at": timestamp,
            }
        payload["annotations"] = list(stored.values())
        write_cache(cache, payload)
        generated += len(batch)
        print(f"checkpointed {generated}/{len(stale)} annotation pairs", flush=True)
    return generated, len(stale)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    imported = subparsers.add_parser("import-legacy")
    imported.add_argument("--sqlite", type=Path, required=True)
    imported.add_argument("--cache", type=Path, default=Path("annotations/ism.json"))
    checked = subparsers.add_parser("check")
    checked.add_argument("--database", type=Path, default=Path("build/rule1.sqlite3"))
    checked.add_argument("--cache", type=Path, default=Path("annotations/ism.json"))
    checked.add_argument("--require-complete", action="store_true")
    generated = subparsers.add_parser("generate")
    generated.add_argument("--database", type=Path, default=Path("build/rule1.sqlite3"))
    generated.add_argument("--cache", type=Path, default=Path("annotations/ism.json"))
    generated.add_argument("--batch-size", type=int, default=25)
    manifested = subparsers.add_parser("record-legacy-manifest")
    manifested.add_argument("--database", type=Path, default=Path("build/rule1.sqlite3"))
    manifested.add_argument("--cache", type=Path, default=Path("annotations/ism.json"))
    manifested.add_argument("--manifest", type=Path, default=Path("annotations/legacy-preservation.json"))
    args = parser.parse_args()
    try:
        if args.command == "import-legacy":
            count = import_legacy(args.sqlite, args.cache)
            print(f"imported {count} verified legacy annotation pairs")
        elif args.command == "record-legacy-manifest":
            count = write_legacy_manifest(args.database, args.cache, args.manifest)
            print(f"recorded {count} legacy annotation digests")
        elif args.command == "generate":
            count, stale = generate(args.database, args.cache, os.environ.get("OPENROUTER_API_KEY", ""), args.batch_size)
            print(f"generated {count} of {stale} stale annotation pairs")
        else:
            total, fresh, stale = cache_status(args.database, args.cache)
            print(f"annotation coverage: {fresh}/{total} current, {stale} stale or missing")
            if args.require_complete and stale:
                raise ValueError("annotation cache is incomplete or stale")
    except (OSError, RuntimeError, ValueError, sqlite3.Error, urllib.error.URLError) as error:
        print(f"annotation operation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
