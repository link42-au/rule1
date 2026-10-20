"""Lossless reader for ASD Essentials for Enterprise IT OSCAL catalogs.

This is deliberately separate from the ISM parser: Essentials actions, principles
and indicators are different concepts from ISM controls. Source properties and
parts remain intact for future database/UI integration.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

ESSENTIALS_NS = "https://www.cyber.gov.au/ns/essentials/oscal/1.0"


def _items(value: Any, label: str) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise ValueError(f"{label} must be an array of objects")
    return value


def parse_essentials_catalog(path: Path) -> dict[str, Any]:
    """Read an ASD catalog without discarding namespaced OSCAL extensions.

    Returns the complete original catalog and an ordered, searchable projection.
    No semantic mappings or implied ISM equivalences are introduced.
    """
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or not isinstance(document.get("catalog"), dict):
        raise ValueError("expected an OSCAL catalog document")
    catalog = document["catalog"]
    metadata = catalog.get("metadata")
    if not isinstance(metadata, dict) or not metadata.get("title"):
        raise ValueError("OSCAL catalog metadata.title is required")

    principles: list[dict[str, Any]] = []
    actions: list[dict[str, Any]] = []
    seen: set[str] = set()

    def walk_controls(controls: Any, principle: str | None) -> None:
        for control in _items(controls, "controls"):
            identifier = control.get("id")
            if not isinstance(identifier, str) or not identifier:
                raise ValueError("OSCAL control.id is required")
            if identifier in seen:
                raise ValueError(f"duplicate OSCAL control id: {identifier}")
            seen.add(identifier)
            props = _items(control.get("props"), "control.props")
            domains = [
                prop.get("value") for prop in props
                if prop.get("ns") == ESSENTIALS_NS and prop.get("name") == "domain"
            ]
            actions.append({
                "id": identifier,
                "title": control.get("title", ""),
                "principle": principle,
                "domains": domains,
                "props": copy.deepcopy(props),
                "parts": copy.deepcopy(_items(control.get("parts"), "control.parts")),
                "links": copy.deepcopy(_items(control.get("links"), "control.links")),
                "raw": copy.deepcopy(control),
            })
            walk_controls(control.get("controls"), principle)

    def walk_groups(groups: Any, parent: str | None = None) -> None:
        for group in _items(groups, "groups"):
            identifier = group.get("id")
            if not isinstance(identifier, str) or not identifier:
                raise ValueError("OSCAL group.id is required")
            is_principle = group.get("class") == "essentials-principle"
            current = identifier if is_principle else parent
            if is_principle:
                principles.append({
                    "id": identifier,
                    "title": group.get("title", ""),
                    "parent": parent,
                    "raw": copy.deepcopy(group),
                })
            walk_controls(group.get("controls"), current)
            walk_groups(group.get("groups"), current)

    walk_controls(catalog.get("controls"), None)
    walk_groups(catalog.get("groups"))
    if not actions:
        raise ValueError("Essentials catalog has no actions")
    return {
        "metadata": copy.deepcopy(metadata),
        "principles": principles,
        "actions": actions,
        "catalog": copy.deepcopy(catalog),
    }

def parse_essentials_snapshot(path: Path) -> dict[str, Any]:
    """Project authoritative Essentials actions into Rule1's existing history schema.

    All OSCAL extension properties and nested evidence indicators are retained
    verbatim in metadata, so a future dedicated view can render them losslessly.
    """
    parsed = parse_essentials_catalog(path)
    groups: list[dict[str, Any]] = []
    controls: dict[str, dict[str, Any]] = {}
    catalog = parsed["catalog"]

    def group_walk(items: Any, parent: str | None = None) -> None:
        for group in _items(items, "groups"):
            gid = group.get("id")
            if not gid:
                raise ValueError("OSCAL group.id is required")
            groups.append({
                "id": gid, "title": group.get("title", gid),
                "parent_id": parent,
                "overview": next((p.get("prose") for p in group.get("parts", [])
                                  if p.get("name") == "overview"), None),
            })
            for action in _items(group.get("controls"), "controls"):
                control_walk(action, gid, group.get("title", gid))
            group_walk(group.get("groups"), gid)

    def control_walk(action: dict[str, Any], section: str, section_title: str) -> None:
        cid = action["id"]
        if cid in controls:
            raise ValueError(f"duplicate OSCAL control id: {cid}")
        props = _items(action.get("props"), "control.props")
        parts = _items(action.get("parts"), "control.parts")
        statement = next((p.get("prose", "") for p in parts
                          if p.get("class") == "essentials-action"), "")
        controls[cid] = {
            "id": cid, "display_id": cid,
            "label": cid, "title": action.get("title", cid),
            "statement": statement, "section_id": section,
            "section_title": section_title, "control_class": "action",
            "source": "oscal",
            "metadata": {
                "oscal": copy.deepcopy(action),
                "domains": [p["value"] for p in props
                            if p.get("name") == "domain" and p.get("ns") == ESSENTIALS_NS],
            },
        }
        for child in _items(action.get("controls"), "control.controls"):
            control_walk(child, section, section_title)

    for action in _items(catalog.get("controls"), "catalog.controls"):
        control_walk(action, "root", parsed["metadata"]["title"])
    group_walk(catalog.get("groups"))
    if len(controls) != len(parsed["actions"]):
        raise ValueError("Essentials action count mismatch")
    return {"groups": groups, "controls": controls}
