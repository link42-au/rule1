"""Lossless reader for ASD Essentials for Enterprise IT OSCAL catalogs.

This is deliberately separate from the ISM parser: Essentials actions, principles
and indicators are different concepts from ISM controls. Source properties and
parts remain intact for future database/UI integration.
"""
from __future__ import annotations

import copy
import hashlib
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


def _validate_extensions(item: dict[str, Any], label: str) -> None:
    for prop in _items(item.get("props"), f"{label}.props"):
        if not isinstance(prop.get("name"), str) or not isinstance(prop.get("value"), str):
            raise ValueError(f"{label} properties require string name and value")
        if "ns" in prop and not isinstance(prop["ns"], str):
            raise ValueError(f"{label} property namespace must be a string")
    for link in _items(item.get("links"), f"{label}.links"):
        if not isinstance(link.get("href"), str):
            raise ValueError(f"{label} link.href must be a string")
    for part in _items(item.get("parts"), f"{label}.parts"):
        if not isinstance(part.get("name"), str):
            raise ValueError(f"{label} part.name is required")
        if "prose" in part and not isinstance(part["prose"], str):
            raise ValueError(f"{label} part.prose must be a string")
        _validate_extensions(part, f"{label}.part")


def load_domain_profiles(directory: Path, version: str) -> dict[str, Any]:
    """Verify retained publisher evidence before reading domain metadata."""
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if manifest["release"] != version or manifest["namespace"] != ESSENTIALS_NS:
        raise ValueError("Essentials supporting source release/namespace mismatch")
    domains: dict[str, Any] = {}
    if {p.name for p in directory.iterdir()} != {"manifest.json", *(a["path"] for a in manifest["artifacts"])}:
        raise ValueError("Essentials supporting source file set mismatch")
    for artifact in manifest["artifacts"]:
        path = directory / artifact["path"]
        if path.resolve().parent != directory.resolve() or path.is_symlink():
            raise ValueError("Essentials supporting source escapes archive")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != artifact["sha256"]:
            raise ValueError(f"Essentials supporting source checksum mismatch: {path.name}")
        if not path.name.endswith("_profile.json"):
            continue
        profile = json.loads(data)["profile"]
        metadata = profile["metadata"]
        _validate_extensions(metadata, "profile.metadata")
        if metadata.get("version") != version:
            raise ValueError("Essentials domain profile version mismatch")
        props = metadata.get("props", [])
        values = lambda name: [p["value"] for p in props if p.get("ns") == ESSENTIALS_NS and p["name"] == name]
        names, descriptions = values("domain"), values("domain-description")
        if len(names) != 1 or len(descriptions) != 1 or names[0] in domains:
            raise ValueError("Essentials domain profile requires one unique domain and description")
        domains[names[0]] = {
            "id": names[0], "description": descriptions[0],
            "phases": values("domain-priority-phase"),
            "profile": copy.deepcopy(profile), "source": artifact["origin"],
        }
    if not domains:
        raise ValueError("Essentials domain profiles are missing")
    return domains


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
    _validate_extensions(metadata, "metadata")

    principles: list[dict[str, Any]] = []
    actions: list[dict[str, Any]] = []
    seen: set[str] = set()
    seen_groups: set[str] = set()

    def walk_controls(controls: Any, principle: str | None) -> None:
        for control in _items(controls, "controls"):
            _validate_extensions(control, "control")
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
            _validate_extensions(group, "group")
            identifier = group.get("id")
            if not isinstance(identifier, str) or not identifier:
                raise ValueError("OSCAL group.id is required")
            if identifier in seen_groups:
                raise ValueError(f"duplicate OSCAL group id: {identifier}")
            seen_groups.add(identifier)
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

def parse_essentials_snapshot(path: Path, profiles_directory: Path | None = None) -> dict[str, Any]:
    """Project authoritative Essentials actions into Rule1's existing history schema.

    All OSCAL extension properties and nested evidence indicators are retained
    verbatim in metadata, so a future dedicated view can render them losslessly.
    """
    parsed = parse_essentials_catalog(path)
    groups: list[dict[str, Any]] = []
    controls: dict[str, dict[str, Any]] = {}
    catalog = parsed["catalog"]
    domains = load_domain_profiles(profiles_directory, parsed["metadata"]["version"]) if profiles_directory else {}
    resources = {r["uuid"]: r for r in _items(catalog.get("back-matter", {}).get("resources"), "resources")}

    def group_walk(items: Any, parent: str | None = None, ancestors: list | None = None) -> None:
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
                control_walk(action, gid, group.get("title", gid), [*(ancestors or []), group])
            group_walk(group.get("groups"), gid, [*(ancestors or []), group])

    def control_walk(action: dict[str, Any], section: str, section_title: str, ancestors: list | None = None) -> None:
        cid = action["id"]
        if cid in controls:
            raise ValueError(f"duplicate OSCAL control id: {cid}")
        props = _items(action.get("props"), "control.props")
        parts = _items(action.get("parts"), "control.parts")
        statement = next((p.get("prose", "") for p in parts
                          if p.get("class") == "essentials-action"), "")
        domain_ids = [p["value"] for p in props if p.get("name") == "domain" and p.get("ns") == ESSENTIALS_NS]
        if profiles_directory and any(d not in domains for d in domain_ids):
            raise ValueError(f"Essentials action references an unknown domain: {cid}")
        context = [{k: copy.deepcopy(v) for k, v in g.items() if k not in {"groups", "controls"}} for g in ancestors or []]
        references = []
        for link in action.get("links", []):
            if link.get("rel") == "mitigated-technique":
                resource = resources.get(link["href"].removeprefix("#"))
                if not resource:
                    raise ValueError(f"Unresolved Essentials technique reference: {cid}")
                references.append(copy.deepcopy(resource))
        controls[cid] = {
            "id": cid, "display_id": cid,
            "label": cid, "title": action.get("title", cid),
            "statement": statement, "section_id": section,
            "section_title": section_title, "control_class": "action",
            "source": "oscal",
            "metadata": {
                "oscal": copy.deepcopy(action),
                "sort_id": next((p["value"] for p in props if p["name"] == "sort-id"), cid),
                "domains": domain_ids,
                "essentials": {
                    "ancestors": context,
                    "catalog_metadata": parsed["metadata"],
                    "domains": [copy.deepcopy(domains[d]) for d in domain_ids if d in domains],
                    "techniques": references,
                },
            },
        }
        for child in _items(action.get("controls"), "control.controls"):
            control_walk(child, section, section_title, ancestors)

    for action in _items(catalog.get("controls"), "catalog.controls"):
        if not any(group["id"] == "root" for group in groups):
            groups.append({"id": "root", "title": parsed["metadata"]["title"], "parent_id": None, "overview": None})
        control_walk(action, "root", parsed["metadata"]["title"])
    group_walk(catalog.get("groups"))
    if len(controls) != len(parsed["actions"]):
        raise ValueError("Essentials action count mismatch")
    return {"groups": groups, "controls": controls}
