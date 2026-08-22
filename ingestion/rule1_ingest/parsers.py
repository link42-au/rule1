"""Reviewed parsers for the framework sources committed under ``data/``."""

from __future__ import annotations

import csv
import html
import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import fitz

Snapshot = dict[str, Any]


def _text(value: object) -> str:
    return re.sub(r"\s+", " ", html.unescape(str(value or ""))).strip()


def _changed(current: dict[str, Any], previous: dict[str, Any] | None) -> str:
    if previous is None:
        return "new"
    visible = (
        "display_id", "label", "title", "statement", "section_id", "section_title",
        "applicability", "applicability_raw", "compliance", "revision", "metadata",
    )
    return "modified" if any(current.get(k) != previous.get(k) for k in visible) else "unchanged"


def _history(framework: str, parsed: list[tuple[dict[str, str], Snapshot]]) -> list[Snapshot]:
    result: list[Snapshot] = []
    previous: dict[str, dict[str, Any]] = {}
    for source, snapshot in parsed:
        live = snapshot["controls"]
        controls: dict[str, dict[str, Any]] = {}
        for control_id in sorted(live):
            control = dict(live[control_id])
            explicit_withdrawal = control.pop("_withdrawn", False)
            control["change_type"] = "withdrawn" if explicit_withdrawal else _changed(control, previous.get(control_id))
            controls[control_id] = control
        for control_id in sorted(previous.keys() - live.keys()):
            withdrawn = dict(previous[control_id])
            withdrawn["change_type"] = "withdrawn"
            controls[control_id] = withdrawn
        result.append({
            "framework": framework,
            "catalog_version": source["version"],
            "commit_date": source["date"],
            "groups": snapshot.get("groups", []),
            "controls": controls,
            "terms": snapshot.get("terms", {}),
        })
        previous = {key: dict(value) for key, value in live.items() if not value.get("_withdrawn")}
    return result


def _parse_ce(path: Path) -> Snapshot:
    data = json.loads(path.read_text(encoding="utf-8"))
    groups = [{
        "id": str(g.get("id", "")), "title": _text(g.get("title")),
        "overview": _text(g.get("overview")) or None, "parent_id": g.get("parent_id"),
    } for g in data.get("groups", [])]
    controls: dict[str, dict[str, Any]] = {}
    for item in data.get("controls", []):
        control_id = str(item.get("id", ""))
        if not control_id or control_id in controls:
            raise ValueError(f"duplicate or empty Cyber Essentials control id in {path}: {control_id!r}")
        controls[control_id] = {
            "id": control_id, "display_id": str(item.get("display_id", "")),
            "label": _text(item.get("label")) or None, "title": _text(item.get("title")) or None,
            "statement": _text(item.get("statement")), "section_id": str(item.get("section_id", "")),
            "section_title": _text(item.get("section_title")), "control_class": item.get("control_class", "control"),
            "source": item.get("source", "json"), "metadata": item.get("metadata", {}),
        }
    return {"groups": groups, "controls": controls}


def _parse_nzism(path: Path) -> Snapshot:
    groups: dict[str, dict[str, Any]] = {}
    controls: dict[str, dict[str, Any]] = {}
    with path.open(encoding="utf-8-sig", errors="replace", newline="") as handle:
        for row in csv.DictReader(handle):
            raw_id = (row.get("CID") or "").strip()
            if not raw_id:
                continue
            try:
                cid = int(raw_id)
            except ValueError:
                continue
            chapter, section, subsection = (_text(row.get(k)) for k in ("Chapter", "Section", "Sub-Section"))
            parent: str | None = None
            group_parts: list[str] = []
            for title in (chapter, section, subsection):
                if not title:
                    continue
                group_parts.append(re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-"))
                group_id = "/".join(group_parts)
                groups.setdefault(group_id, {"id": group_id, "title": title, "overview": None, "parent_id": parent})
                parent = group_id
            control_id = f"nzism-{cid}"
            if control_id in controls:
                raise ValueError(f"duplicate NZISM control id in {path}: {control_id}")
            compliance = _text(row.get("Compliance") or row.get("Compliances"))
            classification = _text(row.get("Classifications"))
            paragraph = _text(row.get("Paragraph"))
            controls[control_id] = {
                "id": control_id, "display_id": f"NZISM-{cid}", "label": paragraph or None,
                "title": None, "statement": _text(re.sub(r"<[^>]+>", " ", str(row.get("ControlText") or ""))),
                "section_id": parent or "", "section_title": subsection or section or chapter,
                "control_class": "control", "source": "csv", "compliance": compliance or None,
                "metadata": {"cid": cid, "paragraph_ref": paragraph or None, "classification": classification or None,
                             "compliance": compliance or None},
            }
    return {"groups": list(groups.values()), "controls": controls}


def _prop(props: list[dict[str, Any]], name: str, class_name: str | None = None) -> str | None:
    for prop in props:
        if prop.get("name") == name and (class_name is None or prop.get("class") == class_name):
            return str(prop.get("value", ""))
    return None


def _part_prose(parts: list[dict[str, Any]], name: str) -> str:
    def collect(part: dict[str, Any]) -> list[str]:
        lines: list[str] = []
        prose = _text(part.get("prose"))
        label = _prop(part.get("props", []), "label")
        if prose:
            lines.append(f"{label} {prose}".strip() if label else prose)
        for child in part.get("parts", []):
            lines.extend(collect(child))
        return lines
    for part in parts:
        if part.get("name") == name:
            return "\n".join(collect(part))
    return ""


def _resolve_params(statement: str, params: list[dict[str, Any]]) -> str:
    values: dict[str, str] = {}
    for param in params:
        param_id = str(param.get("id", ""))
        if param_id:
            values[param_id] = _text(param.get("label")) or param_id
    return re.sub(r"\{\{\s*insert:\s*param,\s*([^}]+?)\s*\}\}",
                  lambda match: f"[{values.get(match.group(1).strip(), match.group(1).strip())}]", statement)


def _display_80053(control_id: str, props: list[dict[str, Any]]) -> str:
    label = _prop([p for p in props if "class" not in p], "label")
    if label:
        return label
    match = re.fullmatch(r"([a-z]+)-(\d+)\.(\d+)", control_id.lower())
    if match:
        return f"{match.group(1).upper()}-{match.group(2)}({match.group(3)})"
    return control_id.upper()


def _parse_nist(path: Path, framework: str) -> Snapshot:
    catalog = json.loads(path.read_text(encoding="utf-8"))["catalog"]
    groups: list[dict[str, Any]] = []
    controls: dict[str, dict[str, Any]] = {}
    for group in catalog.get("groups", []):
        group_id = str(group["id"]).lower()
        group_title = _text(group.get("title"))
        groups.append({"id": group_id, "title": group_title,
                       "overview": _part_prose(group.get("parts", []), "statement") or None, "parent_id": None})
        for base in group.get("controls", []):
            for item in [base, *base.get("controls", [])]:
                raw_id = str(item["id"])
                db_id = f"{framework}-{raw_id.lower()}"
                if db_id in controls:
                    raise ValueError(f"duplicate NIST control id in {path}: {db_id}")
                props = item.get("props", [])
                display_id = raw_id if framework == "nist-csf" else _display_80053(raw_id, props)
                statement = _part_prose(item.get("parts", []), "statement")
                if framework == "nist-800-53":
                    statement = _resolve_params(statement, item.get("params", []))
                status = (_prop(props, "status") or "").lower()
                parent_display = _display_80053(str(base["id"]), base.get("props", []))
                controls[db_id] = {
                    "id": db_id, "display_id": display_id, "label": _text(item.get("title")) or display_id,
                    "title": _text(item.get("title")) or None, "statement": statement,
                    "section_id": group_id, "section_title": group_title,
                    "control_class": ("category" if framework == "nist-csf" and item is base else
                                      "subcategory" if framework == "nist-csf" else
                                      "control-enhancement" if item is not base else "control"),
                    "source": "oscal", "metadata": {"sort_id": _prop(props, "sort-id"),
                        "parent_control": parent_display if item is not base else None},
                    "_withdrawn": status == "withdrawn",
                }
    return {"groups": groups, "controls": controls}


_ISM_HEADER = re.compile(r"(?:Security\s+)?Control:\s*(?:ISM-)?(\d{1,4})\s*;[^\n]+", re.I)
_APP = {"u": "NC", "ic": "OS", "r/p": "P", "c": "C", "s/hp": "S", "g": "NC", "ud": "NC",
        "o": "NC", "p": "P", "s": "S", "ts": "TS"}
_SKIP_GUIDELINES = {"foreword", "contents", "table of contents", "controls", "rationale", "references",
                    "objective", "scope", "context", "unclassified", "information security manual",
                    "australian government information security manual", "australian information security manual"}


def _ism_guidelines(full_text: str) -> list[tuple[int, str]]:
    """Retain the old parser's three generations of ISM section headings."""
    found: list[tuple[int, str]] = []
    patterns = (
        re.compile(r"^Guidelines? for (.+)$", re.I | re.M),
        re.compile(r"(?:CONTROLS\s*\|)?\s*\d{4}\s+INFORMATION SECURITY MANUAL(?:\s*\|\s*\w+)?\s*\n([^\n]+)\n", re.I),
        re.compile(r"Australian (?:Government )?Information Security Manual\s*\n([^\n]+)\n", re.I),
    )
    for pattern in patterns:
        for match in pattern.finditer(full_text):
            title = _text(match.group(1)).rstrip(".").title()
            lowered = title.lower()
            if (3 < len(title) < 80 and lowered not in _SKIP_GUIDELINES
                    and not title.isdigit() and not re.match(r"(?:security\s+)?control:", title, re.I)
                    and not re.search(r"\b(?:where|when|which|that)\b", title, re.I)):
                found.append((match.start(), title))
    return sorted(set(found))


def _ism_guideline_at(index: list[tuple[int, str]], position: int) -> str | None:
    result = None
    for offset, title in index:
        if offset >= position:
            break
        result = title
    return result


def _ism_statement(raw: str) -> str:
    lines: list[str] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            if lines:
                lines.append("")
            continue
        if re.fullmatch(r"\d{1,4}|unclassified", line, re.I):
            continue
        if re.fullmatch(r"(?:australian (?:government )?)?information security manual", line, re.I):
            continue
        if re.fullmatch(r"further information|rationale|references", line, re.I):
            break
        # The old parser removes short title-like lines embedded between prose.
        if (4 <= len(line) <= 60 and line[0].isupper() and line[-1] not in ".!?;:,"
                and 2 <= len(line.split()) <= 8 and not re.match(r"^[•\-*\d]", line)):
            continue
        lines.append(line)
    statement = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    if len(statement) > 2000:
        truncated = statement[:2000]
        boundary = truncated.rfind(". ")
        statement = truncated[:boundary + 1] if boundary > 1000 else truncated.rstrip()
    return statement


def _parse_ism(path: Path) -> Snapshot:
    with fitz.open(path) as document:
        full_text = "\n".join(page.get_text() for page in document)
    matches = list(_ISM_HEADER.finditer(full_text))
    guidelines = _ism_guidelines(full_text)
    controls: dict[str, dict[str, Any]] = {}
    for index, match in enumerate(matches):
        fields: dict[str, str] = {}
        for part in re.split(r"\s*;\s*", match.group(0).strip()):
            field = re.match(r"([^:]+):\s*(.*)", part)
            if field:
                fields[field.group(1).strip().lower().replace(" ", "_")] = field.group(2).strip()
        number = match.group(1).zfill(4)
        control_id = f"ism-{number}"
        if control_id in controls:
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(full_text)
        guideline = _ism_guideline_at(guidelines, match.start())
        section_id = re.sub(r"[^a-z0-9]+", "-", (guideline or "").lower()).strip("-")
        raw_applicability = fields.get("applicability", "")
        applicability = (["NC", "OS", "P", "S", "TS"] if raw_applicability.lower() == "all" else
                         list(dict.fromkeys(_APP[c.strip().lower()] for c in raw_applicability.split(",")
                                            if c.strip().lower() in _APP)))
        e8 = fields.get("essential_eight", "")
        controls[control_id] = {
            "id": control_id, "display_id": control_id.upper(), "label": control_id.upper(), "title": None,
            "statement": _ism_statement(full_text[match.end():end]),
            "section_id": section_id, "section_title": guideline or "", "control_class": "ISM-control", "source": "pdf",
            "applicability": applicability, "applicability_raw": [v.strip() for v in raw_applicability.split(",") if v.strip()],
            "compliance": _text(fields.get("compliance") or fields.get("priority")).lower() or None,
            "revision": fields.get("revision", "0"), "updated": fields.get("updated", ""), "guideline": guideline,
            "e8_levels": [] if e8.upper() in ("", "N/A") else [v.strip() for v in e8.split(",") if v.strip()],
            "metadata": {"authority": fields.get("authority")},
        }
    if not controls:
        raise ValueError(f"no ISM controls parsed from {path}")
    group_titles = sorted({control["section_title"] for control in controls.values() if control["section_title"]})
    groups = [{"id": re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-"), "title": title,
               "overview": None, "parent_id": None} for title in group_titles]
    return {"groups": groups, "controls": controls}


def build_all_histories(root: Path) -> list[Snapshot]:
    """Parse every ingestible ledger version in ledger order."""
    root = root.resolve()
    ledger = json.loads((root / "data/source-ledger.json").read_text(encoding="utf-8"))["sources"]
    chosen: dict[tuple[str, str], dict[str, str]] = {}
    for source in ledger:
        key = (source["framework"], source["version"])
        if source["framework"] == "cyber-essentials" and not source["path"].endswith(".json"):
            continue
        if key in chosen:
            raise ValueError(f"multiple ingestible sources for {key}")
        chosen[key] = source
    by_framework: dict[str, list[dict[str, str]]] = {}
    for source in chosen.values():
        by_framework.setdefault(source["framework"], []).append(source)
    parsers: dict[str, Callable[[Path], Snapshot]] = {
        "cyber-essentials": _parse_ce, "ism": _parse_ism, "nzism": _parse_nzism,
        "nist-csf": lambda path: _parse_nist(path, "nist-csf"),
        "nist-800-53": lambda path: _parse_nist(path, "nist-800-53"),
    }
    snapshots: list[Snapshot] = []
    for framework in sorted(by_framework):
        sources = sorted(by_framework[framework], key=lambda value: (value["date"], value["version"]))
        parsed = [(source, parsers[framework](root / source["path"])) for source in sources]
        snapshots.extend(_history(framework, parsed))
    return snapshots
