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

_OSCAL_UUID_LINK_RE = re.compile(
    r"\[([^\]]+)\]\(#[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)",
    re.IGNORECASE,
)
_ISM_NS_PREFIX = "https://cyber.gov.au/ns/ism/oscal/"
_ALL_APPLICABILITY = ["NC", "OS", "P", "S", "TS"]
_GLOSSARY_TITLE = "glossary of cybersecurity terms"
_SMALL_TITLE_WORDS = {"and", "or", "the", "of", "in", "for", "to", "a", "an", "at", "by", "from", "with"}


def _text(value: object) -> str:
    return re.sub(r"\s+", " ", html.unescape(str(value or ""))).strip()


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def _normalized_title(value: str) -> str:
    return value.lower().replace("cyber security", "cybersecurity").strip()


def _ism_title_case(value: str) -> str:
    words = value.split(" ")
    return " ".join(
        word.lower() if index > 0 and word.lower() in _SMALL_TITLE_WORDS
        else word[:1].upper() + word[1:]
        for index, word in enumerate(words)
    )


def _ism_root_title(value: str) -> str:
    match = re.match(r"^(Guidelines\s+for\s+)(.+)$", value, re.IGNORECASE)
    if not match:
        return value
    suffix = match.group(2).rstrip(".")
    return _ism_title_case(suffix) if suffix[:1].islower() else suffix


def _ism_guideline_title(value: str) -> str:
    title = _ism_title_case(_ism_root_title(value))
    return re.sub(r"\bcyber security\b", "Cybersecurity", title, flags=re.IGNORECASE)


def _strip_oscal_uuid_links(value: str) -> str:
    return _OSCAL_UUID_LINK_RE.sub(r"\1", value)


def _ism_prop_values(props: list[dict[str, Any]], name: str) -> list[str]:
    return [
        str(prop["value"])
        for prop in props
        if prop.get("name") == name
        and str(prop.get("ns") or "").startswith(_ISM_NS_PREFIX)
        and prop.get("value") is not None
    ]


def _ism_prop(props: list[dict[str, Any]], name: str) -> str | None:
    values = _ism_prop_values(props, name)
    return values[0] if values else None


def _ism_applicability(props: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    raw = _ism_prop_values(props, "applicability")
    return (list(_ALL_APPLICABILITY) if not raw or raw == ["ALL"] else raw, raw)


def _raw_part_prose(parts: list[dict[str, Any]], name: str) -> str:
    for part in parts:
        if part.get("name") == name and part.get("prose"):
            return _strip_oscal_uuid_links(str(part["prose"]))
    return ""


def _parse_markdown_table(prose: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    past_separator = False
    for line in prose.strip().splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        if re.match(r"\|[-| ]+\|", stripped):
            past_separator = True
            continue
        if past_separator:
            cells = [_text(cell) for cell in stripped.strip("|").split("|")]
            if len(cells) >= 2 and cells[0]:
                rows.append({"term": cells[0], "meaning": cells[1]})
    return rows


def _find_group_by_title(groups: list[dict[str, Any]], normalized_title: str) -> dict[str, Any] | None:
    for group in groups:
        if _normalized_title(str(group.get("title", ""))) == normalized_title:
            return group
        found = _find_group_by_title(group.get("groups", []), normalized_title)
        if found:
            return found
    return None


def _parse_ism_terms(groups: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    glossary = _find_group_by_title(groups, _GLOSSARY_TITLE)
    if not glossary:
        return {}
    terms: dict[str, dict[str, str]] = {}
    for entry in _parse_markdown_table(_raw_part_prose(glossary.get("parts", []), "overview")):
        term_id = _slug(entry["term"])
        if term_id:
            terms[term_id] = {"id": term_id, **entry}
    return terms


def _changed(current: dict[str, Any], previous: dict[str, Any] | None) -> str:
    if previous is None:
        return "new"
    pdf_to_oscal = previous.get("source") == "pdf" and current.get("source") == "oscal"
    if pdf_to_oscal:
        # At the single source-format boundary, OSCAL repairs fields the PDF
        # parser could not represent. Revision remains the publisher's signal
        # for whether a common control changed semantically in that release.
        boundary_visible = ("display_id", "label", "title", "compliance", "revision", "control_class")
        return "modified" if any(current.get(key) != previous.get(key) for key in boundary_visible) else "unchanged"
    visible = (
        "display_id", "label", "title", "statement", "section_id", "section_title",
        "applicability", "compliance", "metadata",
        "control_class", "e8_levels",
    )
    for key in visible:
        current_value, previous_value = current.get(key), previous.get(key)
        if key == "statement":
            current_value, previous_value = _text(current_value), _text(previous_value)
        elif key == "metadata":
            current_value = {name: value for name, value in (current_value or {}).items() if name != "sort_id"}
            previous_value = {name: value for name, value in (previous_value or {}).items() if name != "sort_id"}
        if current_value != previous_value:
            return "modified"
    return "unchanged"


def _history(framework: str, parsed: list[tuple[dict[str, str], Snapshot]]) -> list[Snapshot]:
    result: list[Snapshot] = []
    previous: dict[str, dict[str, Any]] = {}
    previous_terms: dict[str, dict[str, Any]] = {}
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
        terms: dict[str, dict[str, Any]] = {}
        for term_id, raw_term in sorted(snapshot.get("terms", {}).items()):
            term = dict(raw_term)
            prior_term = previous_terms.get(term_id)
            term["change_type"] = (
                "new" if prior_term is None
                else "modified" if _text(term.get("meaning")) != _text(prior_term.get("meaning"))
                else "unchanged"
            )
            terms[term_id] = term
        result.append({
            "framework": framework,
            "catalog_version": source["version"],
            "commit_date": source["date"],
            "groups": snapshot.get("groups", []),
            "controls": controls,
            "terms": terms,
        })
        previous = {key: dict(value) for key, value in live.items() if not value.get("_withdrawn")}
        previous_terms = {key: dict(value) for key, value in snapshot.get("terms", {}).items()}
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


_MODERN_ISM_HEADER = re.compile(
    r"^Control: ISM-(\d{4}); Revision: ([^;]+); Updated: ([^;]+); "
    r"Applicable: ([^;]+); Essential 8: (.+)$"
)
_ISM_PRINCIPLE = re.compile(r"^(GOV|IDE|PRO|DET|RES|REC)-(\d{2})\s+[–-]\s+([^:]+):\s*(.*)$")


def _join_pdf_lines(lines: list[str]) -> str:
    """Join visual PDF lines while repairing words hyphenated at line endings."""
    result = ""
    for raw_line in lines:
        line = _text(raw_line)
        if not line:
            continue
        if result.endswith("-"):
            result += line
        else:
            result = f"{result} {line}".strip()
    return result


def _parse_modern_ism_pdf(path: Path, previous: Snapshot) -> Snapshot:
    """Parse the post-OSCAL ISM layout and retain OSCAL's structured hierarchy."""
    raw_controls: dict[str, dict[str, Any]] = {}
    raw_principles: dict[str, tuple[str, str]] = {}
    pending_principle: tuple[str, int] | None = None
    current_root_title = ""
    current_parent_title = ""
    current_section_title = ""

    with fitz.open(path) as document:
        for page_number, page in enumerate(document):
            for block in page.get_text("dict", sort=True).get("blocks", []):
                if "lines" not in block:
                    continue
                lines = [
                    "".join(str(span.get("text", "")) for span in line.get("spans", [])).strip()
                    for line in block["lines"]
                ]
                if not lines:
                    continue
                visible_spans = [
                    span for line in block["lines"] for span in line.get("spans", [])
                    if _text(span.get("text"))
                ]
                if visible_spans and all("Bold" in str(span.get("font", "")) for span in visible_spans):
                    size = round(float(visible_spans[0].get("size", 0)))
                    heading = _join_pdf_lines(lines)
                    if size == 24:
                        current_root_title = _ism_root_title(heading)
                    elif size == 18:
                        current_parent_title = heading
                    elif size == 16:
                        current_section_title = heading
                header = _MODERN_ISM_HEADER.fullmatch(lines[0])
                if header:
                    number, revision, updated, raw_applicability, raw_e8 = header.groups()
                    control_id = f"ism-{number}"
                    if control_id in raw_controls:
                        raise ValueError(f"duplicate modern ISM control id in {path}: {control_id}")
                    applicability_raw = [value.strip() for value in raw_applicability.split(",") if value.strip()]
                    raw_controls[control_id] = {
                        "statement": _join_pdf_lines(lines[1:]),
                        "applicability": (list(_ALL_APPLICABILITY)
                                          if applicability_raw == ["ALL"] else applicability_raw),
                        "applicability_raw": applicability_raw,
                        "revision": revision.strip(),
                        "updated": updated.strip(),
                        "e8_levels": ([] if raw_e8.strip().upper() == "N/A"
                                      else [value.strip() for value in raw_e8.split(",") if value.strip()]),
                        "_pdf_parent_title": current_parent_title,
                        "_pdf_root_title": current_root_title,
                        "_pdf_section_title": current_section_title,
                    }
                    pending_principle = None
                    continue

                # The principles occupy document pages 11-15. GOV-02 and DET-04
                # continue in a plain block at the top of the following page.
                if 10 <= page_number <= 14:
                    principle_text = _join_pdf_lines(lines).removeprefix("\uf0b7 ").strip()
                    principle = _ISM_PRINCIPLE.fullmatch(principle_text)
                    if principle:
                        family, number, title, statement = principle.groups()
                        principle_id = f"ism-principle-{family.lower()}-{number}"
                        if principle_id in raw_principles:
                            raise ValueError(f"duplicate modern ISM principle id in {path}: {principle_id}")
                        raw_principles[principle_id] = (_text(title), _text(statement))
                        pending_principle = (principle_id, page_number)
                    elif (pending_principle and page_number == pending_principle[1] + 1
                          and principle_text[:1].islower()):
                        principle_id = pending_principle[0]
                        title, statement = raw_principles[principle_id]
                        raw_principles[principle_id] = (title, f"{statement} {principle_text}".strip())
                        pending_principle = None

    if len(raw_controls) != 1_143:
        raise ValueError(f"expected 1143 modern ISM controls in {path}, found {len(raw_controls)}")
    if len(raw_principles) != 49:
        raise ValueError(f"expected 49 modern ISM principles in {path}, found {len(raw_principles)}")

    prior_controls = previous["controls"]
    controls: dict[str, dict[str, Any]] = {}
    groups = [dict(group) for group in previous.get("groups", [])]
    groups_by_id = {group["id"]: group for group in groups}
    pdf_control_ids = list(raw_controls)
    for sequence, (control_id, pdf_fields) in enumerate(raw_controls.items(), start=1):
        parent_title = pdf_fields.pop("_pdf_parent_title")
        root_title = pdf_fields.pop("_pdf_root_title")
        section_title = pdf_fields.pop("_pdf_section_title")
        prior = prior_controls.get(control_id)
        if prior is None:
            pdf_index = sequence - 1
            neighbour = next(
                prior_controls[candidate]
                for distance in range(1, len(pdf_control_ids))
                for candidate_index in (pdf_index - distance, pdf_index + distance)
                if 0 <= candidate_index < len(pdf_control_ids)
                for candidate in (pdf_control_ids[candidate_index],)
                if candidate in prior_controls
            )
            matching_groups = [
                group for group in groups
                if _normalized_title(str(group.get("title", ""))) == _normalized_title(section_title)
            ]
            matching_group = next((
                group for group in matching_groups
                if _normalized_title(str(groups_by_id.get(group.get("parent_id"), {}).get("title", "")))
                == _normalized_title(parent_title)
            ), matching_groups[0] if len(matching_groups) == 1 else None)
            if matching_group is None:
                matching_parents = [
                    group for group in groups
                    if _normalized_title(str(group.get("title", ""))) == _normalized_title(parent_title)
                ]
                neighbour_group = groups_by_id.get(neighbour["section_id"], {})
                if len(matching_parents) == 1:
                    parent_id = matching_parents[0]["id"]
                else:
                    matching_roots = [
                        group for group in groups
                        if group.get("parent_id") is None
                        and _normalized_title(str(group.get("title", ""))) == _normalized_title(root_title)
                    ]
                    if len(matching_roots) == 1:
                        parent_id = f"{matching_roots[0]['id']}/{_slug(parent_title)}"
                        parent_group = {
                            "id": parent_id,
                            "title": parent_title,
                            "overview": None,
                            "parent_id": matching_roots[0]["id"],
                        }
                        groups.append(parent_group)
                        groups_by_id[parent_id] = parent_group
                    else:
                        parent_id = neighbour_group.get("parent_id")
                group_id = f"{parent_id}/{_slug(section_title)}" if parent_id else _slug(section_title)
                matching_group = {
                    "id": group_id,
                    "title": section_title,
                    "overview": None,
                    "parent_id": parent_id,
                }
                groups.append(matching_group)
                groups_by_id[group_id] = matching_group
            control = {
                "id": control_id,
                "display_id": control_id.upper(),
                "label": control_id.upper(),
                "title": None,
                "section_id": matching_group["id"],
                "section_title": matching_group["title"],
                "control_class": "ISM-control",
                "guideline": neighbour.get("guideline"),
                "compliance": neighbour.get("compliance"),
                "metadata": {"authority": None},
            }
        else:
            control = dict(prior)
            control["metadata"] = dict(prior.get("metadata") or {})
        control["metadata"]["sort_id"] = f"pdf[{sequence:04d}]"
        control.update(pdf_fields)
        control["source"] = "pdf"
        controls[control_id] = control

    for principle_id, (title, statement) in raw_principles.items():
        if principle_id not in prior_controls:
            raise ValueError(f"modern ISM principle missing from prior OSCAL structure: {principle_id}")
        principle = dict(prior_controls[principle_id])
        principle["metadata"] = dict(principle.get("metadata") or {})
        principle.update({"title": title, "statement": statement, "source": "pdf"})
        controls[principle_id] = principle

    return {
        "groups": groups,
        "controls": controls,
        "terms": {term_id: dict(term) for term_id, term in previous.get("terms", {}).items()},
    }


def _parse_ism_oscal(path: Path) -> Snapshot:
    """Parse ASD's OSCAL catalog using the reviewed original Rule1 semantics."""
    catalog = json.loads(path.read_text(encoding="utf-8"))["catalog"]
    seen_control_ids: set[str] = set()

    def parse_control(item: dict[str, Any], group_id: str, group_title: str,
                      guideline: str) -> dict[str, Any]:
        raw_id = str(item.get("id", "")).lower()
        if not raw_id or raw_id in seen_control_ids:
            raise ValueError(f"duplicate or empty ISM OSCAL control id in {path}: {raw_id!r}")
        seen_control_ids.add(raw_id)
        props = item.get("props", [])
        applicability, applicability_raw = _ism_applicability(props)
        control_class = str(item.get("class") or "ISM-control")
        is_principle = control_class == "ISM-principle"
        label = _prop(props, "label") if is_principle else None
        return {
            "id": raw_id,
            "display_id": label or raw_id.upper(),
            "label": label or raw_id.upper(),
            "title": (_text(item.get("title")) or None) if is_principle else None,
            "statement": _text(_strip_oscal_uuid_links(_part_prose(item.get("parts", []), "statement"))),
            "section_id": group_id,
            "section_title": group_title,
            "control_class": control_class,
            "source": "oscal",
            "applicability": applicability,
            "applicability_raw": applicability_raw,
            "revision": _ism_prop(props, "revision") or "0",
            "updated": _ism_prop(props, "updated") or "",
            "guideline": guideline,
            "e8_levels": _ism_prop_values(props, "essential-eight-applicability"),
            "metadata": {"authority": None, "sort_id": _prop(props, "sort-id")},
        }

    def traverse(items: list[dict[str, Any]], parent_id: str | None = None,
                 guideline: str | None = None) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
        retained_groups: list[dict[str, Any]] = []
        retained_controls: dict[str, dict[str, Any]] = {}
        for group in items:
            raw_title = _text(group.get("title"))
            raw_id = str(group.get("id") or "")
            current_id = raw_id or (f"{parent_id}/{_slug(raw_title)}" if parent_id else _slug(raw_title))
            current_id = current_id.replace("cyber-security", "cybersecurity")
            stored_title = _ism_root_title(raw_title) if parent_id is None else raw_title
            current_guideline = guideline or _ism_guideline_title(raw_title)

            child_groups, child_controls = traverse(group.get("groups", []), current_id, current_guideline)
            direct_controls: dict[str, dict[str, Any]] = {}

            def add_controls(controls: list[dict[str, Any]]) -> None:
                for item in controls:
                    parsed = parse_control(item, current_id, stored_title, current_guideline)
                    direct_controls[parsed["id"]] = parsed
                    add_controls(item.get("controls", []))

            add_controls(group.get("controls", []))
            if direct_controls or child_controls:
                retained_groups.append({
                    "id": current_id,
                    "title": stored_title,
                    "overview": _text(_strip_oscal_uuid_links(
                        _part_prose(group.get("parts", []), "overview")
                    )) or None,
                    "parent_id": parent_id,
                })
                retained_groups.extend(child_groups)
                retained_controls.update(child_controls)
                retained_controls.update(direct_controls)
        return retained_groups, retained_controls

    groups, controls = traverse(catalog.get("groups", []))
    if not controls:
        raise ValueError(f"no ISM controls parsed from {path}")
    return {"groups": groups, "controls": controls, "terms": _parse_ism_terms(catalog.get("groups", []))}


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
        parsed = []
        for source in sources:
            path = root / source["path"]
            if (framework == "ism" and path.suffix == ".pdf" and parsed
                    and Path(parsed[-1][0]["path"]).suffix == ".json"):
                snapshot = _parse_modern_ism_pdf(path, parsed[-1][1])
            else:
                parser = _parse_ism_oscal if framework == "ism" and path.suffix == ".json" else parsers[framework]
                snapshot = parser(path)
            parsed.append((source, snapshot))
        snapshots.extend(_history(framework, parsed))
    return snapshots
