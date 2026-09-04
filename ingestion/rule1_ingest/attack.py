"""Deterministic Enterprise ATT&CK parsing and ISM mapping expansion."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any, Literal, TypedDict

Effect = Literal["prevent", "constrain", "detect", "recover"]
Confidence = Literal["low", "medium", "high"]
MappingStatus = Literal["candidate", "reviewed", "rejected"]

EFFECTS = frozenset({"prevent", "constrain", "detect", "recover"})
CONFIDENCES = frozenset({"low", "medium", "high"})
DECISION_STATUSES = frozenset({"reviewed", "rejected"})
ATTACK_VERSION = "19.2"
ATTACK_RELEASE_DATE = "2026-08-06"
ISM_VERSION = "ISM-OSCAL-2026.09.4"
E8_CONTROL_COUNT = 126


class AttackTechnique(TypedDict):
    technique_id: str
    stix_id: str
    name: str
    description: str
    url: str
    tactics: list[str]
    platforms: list[str]
    parent_technique_id: str | None


class AttackMitigation(TypedDict):
    mitigation_id: str
    stix_id: str
    name: str
    description: str
    url: str


class AttackRelationship(TypedDict):
    relationship_stix_id: str
    mitigation_id: str
    technique_id: str
    description: str


class AttackCatalog(TypedDict):
    version: str
    release_date: str
    techniques: list[AttackTechnique]
    mitigations: list[AttackMitigation]
    relationships: list[AttackRelationship]


class MappingBridge(TypedDict):
    bridge_id: str
    control_id: str
    mitigation_id: str
    effect: Effect
    confidence: Confidence
    rationale: str
    evidence: list[dict[str, Any]]


class MappingDecision(TypedDict):
    bridge_id: str
    technique_id: str
    status: Literal["reviewed", "rejected"]
    rationale: str
    evidence: list[dict[str, Any]]
    reviewed_by: str | None
    reviewed_at: str | None


class ExpandedMapping(TypedDict):
    framework: Literal["ism"]
    ism_catalog_version: str
    attack_version: str
    bridge_id: str
    control_id: str
    mitigation_id: str
    technique_id: str
    effect: Effect
    confidence: Confidence
    rationale: str
    evidence: list[dict[str, Any]]
    status: MappingStatus
    reviewed_by: str | None
    reviewed_at: str | None
    relationship_stix_id: str
    relationship_description: str


def _read_json(source: Path | dict[str, Any]) -> dict[str, Any]:
    if isinstance(source, Path):
        value = json.loads(source.read_text(encoding="utf-8"))
    else:
        value = source
    if not isinstance(value, dict):
        raise ValueError("JSON document must be an object")
    return value


def _active(item: dict[str, Any]) -> bool:
    return not item.get("revoked", False) and not item.get("x_mitre_deprecated", False)


def _required_text(item: dict[str, Any], field: str, context: str) -> str:
    value = item.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{context} has blank or missing {field}")
    return value.strip()


def _optional_text(item: dict[str, Any], field: str, context: str) -> str | None:
    value = item.get(field)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{context} has blank {field}")
    return value.strip()


def _string_list(item: dict[str, Any], field: str, context: str) -> list[str]:
    value = item.get(field)
    if not isinstance(value, list) or not value:
        raise ValueError(f"{context} has blank or missing {field}")
    result: list[str] = []
    for entry in value:
        if not isinstance(entry, str) or not entry.strip():
            raise ValueError(f"{context} has blank {field} entry")
        result.append(entry.strip())
    if len(result) != len(set(result)):
        raise ValueError(f"{context} has duplicate {field} entry")
    return sorted(result)


def _evidence_list(item: dict[str, Any], context: str) -> list[dict[str, Any]]:
    value = item.get("evidence")
    if not isinstance(value, list) or not value:
        raise ValueError(f"{context} has blank or missing evidence")
    fingerprints: set[str] = set()
    keyed_evidence: list[tuple[str, dict[str, Any]]] = []
    for entry in value:
        if not isinstance(entry, dict) or not entry:
            raise ValueError(f"{context} evidence entries must be non-empty objects")
        _required_text(entry, "kind", f"{context} evidence entry")
        try:
            fingerprint = json.dumps(entry, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        except (TypeError, ValueError) as error:
            raise ValueError(f"{context} evidence entry must contain JSON values") from error
        if fingerprint in fingerprints:
            raise ValueError(f"{context} has duplicate evidence entry")
        fingerprints.add(fingerprint)
        evidence_entry = dict(entry)
        keyed_evidence.append((fingerprint, evidence_entry))
    return [entry for _, entry in sorted(keyed_evidence)]


def _validate_versions(document: dict[str, Any], context: str) -> None:
    expected = {
        "ism_catalog_version": ISM_VERSION,
        "attack_version": ATTACK_VERSION,
    }
    for field, pinned in expected.items():
        if field in document and document[field] != pinned:
            raise ValueError(f"{context} {field} must be {pinned}")


def _external_reference(item: dict[str, Any], context: str) -> tuple[str, str]:
    references = item.get("external_references", [])
    if not isinstance(references, list):
        raise ValueError(f"{context} external_references must be a list")
    for reference in references:
        if isinstance(reference, dict) and reference.get("source_name") == "mitre-attack":
            external_id = _required_text(reference, "external_id", context)
            external_url = _required_text(reference, "url", context)
            return external_id, external_url
    raise ValueError(f"{context} has no MITRE ATT&CK external reference")


def parse_attack_bundle(source: Path | dict[str, Any]) -> AttackCatalog:
    """Parse the active Enterprise ATT&CK techniques and mitigation graph."""
    bundle = _read_json(source)
    if bundle.get("type") != "bundle" or not isinstance(bundle.get("objects"), list):
        raise ValueError("ATT&CK source must be a STIX bundle")

    objects = bundle["objects"]
    techniques_by_stix: dict[str, AttackTechnique] = {}
    mitigations_by_stix: dict[str, AttackMitigation] = {}
    raw_parent_relationships: list[dict[str, Any]] = []
    raw_mitigation_relationships: list[dict[str, Any]] = []

    for value in objects:
        if not isinstance(value, dict) or not _active(value):
            continue
        object_type = value.get("type")
        if object_type == "attack-pattern":
            stix_id = _required_text(value, "id", "ATT&CK technique")
            external_id, external_url = _external_reference(value, stix_id)
            phases = value.get("kill_chain_phases", [])
            if not isinstance(phases, list):
                raise ValueError(f"{stix_id} kill_chain_phases must be a list")
            tactics = sorted({
                str(phase["phase_name"]).strip()
                for phase in phases
                if isinstance(phase, dict)
                and phase.get("kill_chain_name") == "mitre-attack"
                and str(phase.get("phase_name", "")).strip()
            })
            raw_platforms = value.get("x_mitre_platforms", [])
            if not isinstance(raw_platforms, list):
                raise ValueError(f"{stix_id} x_mitre_platforms must be a list")
            platforms = sorted({str(platform).strip() for platform in raw_platforms if str(platform).strip()})
            if stix_id in techniques_by_stix:
                raise ValueError(f"duplicate ATT&CK technique STIX id: {stix_id}")
            techniques_by_stix[stix_id] = {
                "technique_id": external_id,
                "stix_id": stix_id,
                "name": _required_text(value, "name", stix_id),
                "description": str(value.get("description") or ""),
                "url": external_url,
                "tactics": tactics,
                "platforms": platforms,
                "parent_technique_id": None,
            }
        elif object_type == "course-of-action":
            stix_id = _required_text(value, "id", "ATT&CK mitigation")
            external_id, external_url = _external_reference(value, stix_id)
            if stix_id in mitigations_by_stix:
                raise ValueError(f"duplicate ATT&CK mitigation STIX id: {stix_id}")
            mitigations_by_stix[stix_id] = {
                "mitigation_id": external_id,
                "stix_id": stix_id,
                "name": _required_text(value, "name", stix_id),
                "description": str(value.get("description") or ""),
                "url": external_url,
            }
        elif object_type == "relationship":
            if value.get("relationship_type") == "subtechnique-of":
                raw_parent_relationships.append(value)
            elif value.get("relationship_type") == "mitigates":
                raw_mitigation_relationships.append(value)

    technique_ids = [item["technique_id"] for item in techniques_by_stix.values()]
    mitigation_ids = [item["mitigation_id"] for item in mitigations_by_stix.values()]
    if len(technique_ids) != len(set(technique_ids)):
        raise ValueError("duplicate ATT&CK technique external id")
    if len(mitigation_ids) != len(set(mitigation_ids)):
        raise ValueError("duplicate ATT&CK mitigation external id")

    parents_seen: set[str] = set()
    for relationship in raw_parent_relationships:
        child_stix = str(relationship.get("source_ref") or "")
        parent_stix = str(relationship.get("target_ref") or "")
        if child_stix not in techniques_by_stix or parent_stix not in techniques_by_stix:
            continue
        if child_stix in parents_seen:
            raise ValueError(f"multiple parents for ATT&CK sub-technique: {child_stix}")
        parents_seen.add(child_stix)
        child = techniques_by_stix[child_stix]
        child["parent_technique_id"] = techniques_by_stix[parent_stix]["technique_id"]

    relationships: list[AttackRelationship] = []
    relationship_ids: set[str] = set()
    relationship_pairs: set[tuple[str, str]] = set()
    for relationship in raw_mitigation_relationships:
        mitigation = mitigations_by_stix.get(str(relationship.get("source_ref") or ""))
        technique = techniques_by_stix.get(str(relationship.get("target_ref") or ""))
        if mitigation is None or technique is None:
            continue
        relationship_id = _required_text(relationship, "id", "ATT&CK mitigates relationship")
        pair = (mitigation["mitigation_id"], technique["technique_id"])
        if relationship_id in relationship_ids or pair in relationship_pairs:
            raise ValueError(f"duplicate ATT&CK mitigates relationship: {relationship_id}")
        relationship_ids.add(relationship_id)
        relationship_pairs.add(pair)
        relationships.append({
            "relationship_stix_id": relationship_id,
            "mitigation_id": pair[0],
            "technique_id": pair[1],
            "description": str(relationship.get("description") or ""),
        })

    return {
        "version": ATTACK_VERSION,
        "release_date": ATTACK_RELEASE_DATE,
        "techniques": sorted(techniques_by_stix.values(), key=lambda item: item["technique_id"]),
        "mitigations": sorted(mitigations_by_stix.values(), key=lambda item: item["mitigation_id"]),
        "relationships": sorted(
            relationships,
            key=lambda item: (
                item["mitigation_id"], item["technique_id"], item["relationship_stix_id"]
            ),
        ),
    }


def load_bridges(
    source: Path | dict[str, Any], allowed_controls: set[str], catalog: AttackCatalog
) -> list[MappingBridge]:
    """Load and validate curated ISM-control to ATT&CK-mitigation bridges."""
    document = _read_json(source)
    _validate_versions(document, "mapping bridge document")
    values = document.get("bridges")
    if not isinstance(values, list):
        raise ValueError("mapping bridge document must contain a bridges list")
    unmapped_values = document.get("unmapped")
    if not isinstance(unmapped_values, list):
        raise ValueError("mapping bridge document must contain an unmapped list")
    unmapped_controls: set[str] = set()
    for value in unmapped_values:
        if not isinstance(value, dict):
            raise ValueError("unmapped control must be an object")
        control_id = _required_text(value, "control_id", "unmapped control")
        _required_text(value, "reason", f"unmapped control {control_id}")
        if control_id not in allowed_controls:
            raise ValueError(f"unmapped list has unknown or non-E8 control: {control_id}")
        if control_id in unmapped_controls:
            raise ValueError(f"duplicate unmapped control: {control_id}")
        unmapped_controls.add(control_id)
    mitigation_ids = {item["mitigation_id"] for item in catalog["mitigations"]}
    seen_ids: set[str] = set()
    seen_edges: set[tuple[str, str, str]] = set()
    bridges: list[MappingBridge] = []
    for value in values:
        if not isinstance(value, dict):
            raise ValueError("mapping bridge must be an object")
        mitigation_id = _required_text(value, "mitigation_id", "mapping bridge")
        effect = _required_text(value, "effect", f"bridge for {mitigation_id}")
        confidence = _required_text(value, "confidence", f"bridge for {mitigation_id}/{effect}")
        if mitigation_id not in mitigation_ids:
            raise ValueError(f"mapping bridge has unknown mitigation: {mitigation_id}")
        if effect not in EFFECTS:
            raise ValueError(f"mapping bridge has malformed effect: {effect}")
        if confidence not in CONFIDENCES:
            raise ValueError(f"mapping bridge has malformed confidence: {confidence}")
        if "control_ids" in value:
            control_ids = _string_list(value, "control_ids", f"bridge for {mitigation_id}/{effect}")
        else:
            control_ids = [_required_text(value, "control_id", f"bridge for {mitigation_id}/{effect}")]
        explicit_bridge_id = _optional_text(value, "bridge_id", f"bridge for {mitigation_id}/{effect}")
        if explicit_bridge_id is not None and len(control_ids) != 1:
            raise ValueError("explicit bridge_id requires exactly one control")
        rationale = _required_text(value, "rationale", f"bridge for {mitigation_id}/{effect}")
        evidence = _evidence_list(value, f"bridge for {mitigation_id}/{effect}")
        for control_id in control_ids:
            bridge_id = explicit_bridge_id or (
                f"ism-e8-{control_id.removeprefix('ism-')}-{mitigation_id.lower()}-{effect}"
            )
            if control_id not in allowed_controls:
                raise ValueError(f"{bridge_id} has unknown or non-E8 control: {control_id}")
            edge = (control_id, mitigation_id, effect)
            if bridge_id in seen_ids or edge in seen_edges:
                raise ValueError(f"duplicate mapping bridge: {bridge_id}")
            seen_ids.add(bridge_id)
            seen_edges.add(edge)
            bridges.append({
                "bridge_id": bridge_id,
                "control_id": control_id,
                "mitigation_id": mitigation_id,
                "effect": effect,  # type: ignore[typeddict-item]
                "confidence": confidence,  # type: ignore[typeddict-item]
                "rationale": rationale,
                "evidence": list(evidence),
            })
    bridged_controls = {item["control_id"] for item in bridges}
    overlap = bridged_controls & unmapped_controls
    if overlap:
        raise ValueError(f"controls cannot be both bridged and unmapped: {sorted(overlap)}")
    covered = bridged_controls | unmapped_controls
    if covered != allowed_controls:
        missing = sorted(allowed_controls - covered)
        extra = sorted(covered - allowed_controls)
        raise ValueError(f"bridge coverage must equal allowed controls; missing={missing}, extra={extra}")
    return sorted(bridges, key=lambda item: item["bridge_id"])


def load_decisions(
    source: Path | dict[str, Any], bridges: list[MappingBridge], catalog: AttackCatalog
) -> list[MappingDecision]:
    """Load exact bridge/technique review decisions."""
    document = _read_json(source)
    _validate_versions(document, "mapping decision document")
    values = document.get("decisions")
    if not isinstance(values, list):
        raise ValueError("mapping decision document must contain a decisions list")
    bridge_ids = {item["bridge_id"] for item in bridges}
    technique_ids = {item["technique_id"] for item in catalog["techniques"]}
    expandable = {
        (bridge["bridge_id"], relationship["technique_id"])
        for bridge in bridges
        for relationship in catalog["relationships"]
        if bridge["mitigation_id"] == relationship["mitigation_id"]
    }
    seen: set[tuple[str, str]] = set()
    decisions: list[MappingDecision] = []
    for value in values:
        if not isinstance(value, dict):
            raise ValueError("mapping decision must be an object")
        bridge_id = _required_text(value, "bridge_id", "mapping decision")
        technique_id = _required_text(value, "technique_id", f"decision for {bridge_id}")
        status = _required_text(value, "status", f"decision for {bridge_id}/{technique_id}")
        key = (bridge_id, technique_id)
        if bridge_id not in bridge_ids:
            raise ValueError(f"orphan decision has unknown bridge: {bridge_id}")
        if technique_id not in technique_ids:
            raise ValueError(f"decision has unknown technique: {technique_id}")
        if key not in expandable:
            raise ValueError(f"orphan decision does not match a mitigation relationship: {key}")
        if status not in DECISION_STATUSES:
            raise ValueError(f"decision has malformed status: {status}")
        if key in seen:
            raise ValueError(f"duplicate mapping decision: {key}")
        seen.add(key)
        reviewed_by = _optional_text(
            value, "reviewed_by", f"decision for {bridge_id}/{technique_id}"
        )
        reviewed_at = _optional_text(value, "reviewed_at", f"decision for {bridge_id}/{technique_id}")
        if reviewed_by is None or reviewed_at is None:
            raise ValueError(f"decision requires reviewed_by and reviewed_at: {key}")
        decisions.append({
            "bridge_id": bridge_id,
            "technique_id": technique_id,
            "status": status,  # type: ignore[typeddict-item]
            "rationale": _required_text(value, "rationale", f"decision for {bridge_id}/{technique_id}"),
            "evidence": _evidence_list(value, f"decision for {bridge_id}/{technique_id}"),
            "reviewed_by": reviewed_by,
            "reviewed_at": reviewed_at,
        })
    return sorted(decisions, key=lambda item: (item["bridge_id"], item["technique_id"]))


def expand_mappings(
    bridges: list[MappingBridge], decisions: list[MappingDecision], catalog: AttackCatalog
) -> list[ExpandedMapping]:
    """Expand bridge rules through official mitigation relationships."""
    decision_by_key = {(item["bridge_id"], item["technique_id"]): item for item in decisions}
    relationships_by_mitigation: dict[str, list[AttackRelationship]] = {}
    for relationship in catalog["relationships"]:
        relationships_by_mitigation.setdefault(relationship["mitigation_id"], []).append(relationship)
    expanded: list[ExpandedMapping] = []
    for bridge in bridges:
        for relationship in relationships_by_mitigation.get(bridge["mitigation_id"], []):
            decision = decision_by_key.get((bridge["bridge_id"], relationship["technique_id"]))
            expanded.append({
                "framework": "ism",
                "ism_catalog_version": ISM_VERSION,
                "attack_version": catalog["version"],
                **bridge,
                "technique_id": relationship["technique_id"],
                "rationale": decision["rationale"] if decision else bridge["rationale"],
                "evidence": decision["evidence"] if decision else list(bridge["evidence"]),
                "status": decision["status"] if decision else "candidate",
                "reviewed_by": decision["reviewed_by"] if decision else None,
                "reviewed_at": decision["reviewed_at"] if decision else None,
                "relationship_stix_id": relationship["relationship_stix_id"],
                "relationship_description": relationship["description"],
            })
    return sorted(
        expanded,
        key=lambda item: (
            item["control_id"], item["technique_id"], item["effect"], item["bridge_id"]
        ),
    )


def load_and_expand_mappings(
    bridges_source: Path | dict[str, Any],
    decisions_source: Path | dict[str, Any],
    allowed_controls: set[str],
    catalog: AttackCatalog,
) -> tuple[list[MappingBridge], list[MappingDecision], list[ExpandedMapping]]:
    """Load both curated inputs and return their deterministic expansion."""
    bridges, decisions = load_mapping_inputs(
        bridges_source, decisions_source, allowed_controls, catalog
    )
    return bridges, decisions, expand_mappings(bridges, decisions, catalog)


def load_mapping_inputs(
    bridges_source: Path | dict[str, Any],
    decisions_source: Path | dict[str, Any],
    allowed_controls: set[str],
    catalog: AttackCatalog,
) -> tuple[list[MappingBridge], list[MappingDecision]]:
    """Load and validate the curated bridge and exact-decision documents."""
    bridges = load_bridges(bridges_source, allowed_controls, catalog)
    decisions = load_decisions(decisions_source, bridges, catalog)
    return bridges, decisions


def review_artifacts(
    catalog: AttackCatalog,
    bridges: list[MappingBridge],
    mappings: list[ExpandedMapping],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build deterministic review and ATT&CK Navigator documents."""
    techniques = {item["technique_id"]: item for item in catalog["techniques"]}
    mitigations = {item["mitigation_id"]: item for item in catalog["mitigations"]}
    enriched: list[dict[str, Any]] = []
    for mapping in mappings:
        technique = techniques[mapping["technique_id"]]
        mitigation = mitigations[mapping["mitigation_id"]]
        enriched.append({
            **mapping,
            "technique_name": technique["name"],
            "technique_url": technique["url"],
            "technique_stix_id": technique["stix_id"],
            "mitigation_name": mitigation["name"],
            "mitigation_url": mitigation["url"],
            "mitigation_stix_id": mitigation["stix_id"],
        })
    enriched.sort(key=lambda item: (
        item["control_id"], item["technique_id"], item["effect"], item["bridge_id"]
    ))
    bridged_controls = {item["control_id"] for item in bridges}
    status_counts = Counter(item["status"] for item in mappings)
    effect_counts = Counter(item["effect"] for item in mappings)
    confidence_counts = Counter(item["confidence"] for item in mappings)
    report = {
        "schema_version": 1,
        "ism_catalog_version": ISM_VERSION,
        "attack_version": catalog["version"],
        "attack_release_date": catalog["release_date"],
        "counts": {
            "bridges": len(bridges),
            "mappings": len(mappings),
            "mapped_controls": len(bridged_controls),
            "unmapped_controls": max(0, E8_CONTROL_COUNT - len(bridged_controls)),
            "by_status": {status: status_counts[status] for status in sorted({"candidate", "reviewed", "rejected"})},
            "by_effect": {effect: effect_counts[effect] for effect in sorted(EFFECTS)},
            "by_confidence": {
                confidence: confidence_counts[confidence] for confidence in sorted(CONFIDENCES)
            },
        },
        "mappings": enriched,
    }

    reviewed_by_technique: dict[str, list[ExpandedMapping]] = {}
    for mapping in mappings:
        if mapping["status"] == "reviewed":
            reviewed_by_technique.setdefault(mapping["technique_id"], []).append(mapping)
    navigator_techniques = []
    for technique_id, reviewed in sorted(reviewed_by_technique.items()):
        statements = sorted({
            f"{item['control_id']} may {item['effect']} this technique via {item['mitigation_id']}."
            for item in reviewed
        })
        navigator_techniques.append({
            "techniqueID": technique_id,
            "score": len(reviewed),
            "comment": " ".join(statements),
            "enabled": True,
            "metadata": [
                {"name": "Reviewed mappings", "value": str(len(reviewed))},
                {"name": "ISM catalog", "value": ISM_VERSION},
            ],
        })
    navigator = {
        "name": "Rule1 Essential Eight to Enterprise ATT&CK",
        "description": (
            "Reviewed ISM Essential Eight mappings. A mapping indicates that a control may "
            "prevent, constrain, detect, or support recovery from a technique; it is not a guarantee."
        ),
        "domain": "enterprise-attack",
        "versions": {"attack": catalog["version"], "layer": "4.5", "navigator": "5.1.0"},
        "techniques": navigator_techniques,
    }
    return report, navigator


def write_review_artifacts(
    root: Path,
    catalog: AttackCatalog,
    bridges: list[MappingBridge],
    mappings: list[ExpandedMapping],
) -> tuple[Path, Path]:
    """Write deterministic review artifacts beneath ``mappings/generated``."""
    report, navigator = review_artifacts(catalog, bridges, mappings)
    output = root / "mappings" / "generated"
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / "attack-mapping-review.json"
    navigator_path = output / "attack-navigator-layer.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    navigator_path.write_text(
        json.dumps(navigator, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return report_path, navigator_path
