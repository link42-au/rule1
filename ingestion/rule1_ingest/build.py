"""Build the canonical Rule1 SQLite database from committed sources."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from pathlib import Path
from typing import Any

from .parsers import Snapshot, build_all_histories
from .annotations import MODEL as ANNOTATION_MODEL
from .annotations import PROMPT_VERSION as ANNOTATION_PROMPT_VERSION
from .annotations import load_cache as load_annotation_cache
from .attack import load_and_expand_mappings, parse_attack_bundle, write_review_artifacts

FRAMEWORKS = (
    ("cyber-essentials", "Cyber Essentials", "CE", "UK National Cyber Security Centre", "https://www.ncsc.gov.uk/cyberessentials/overview", "United Kingdom", "#2563eb"),
    ("ism", "Information Security Manual", "ISM", "Australian Signals Directorate", "https://www.cyber.gov.au/business-government/asds-cyber-security-frameworks/ism", "Australia", "#2563eb"),
    ("nist-800-53", "NIST SP 800-53", "NIST 800-53", "National Institute of Standards and Technology", "https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final", "United States", "#2563eb"),
    ("nist-csf", "NIST Cybersecurity Framework", "NIST CSF", "National Institute of Standards and Technology", "https://www.nist.gov/cyberframework", "United States", "#2563eb"),
    ("nzism", "New Zealand Information Security Manual", "NZISM", "New Zealand Government Communications Security Bureau", "https://nzism.gcsb.govt.nz/", "New Zealand", "#2563eb"),
)


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _ledger(root: Path) -> tuple[list[dict[str, str]], str]:
    path = root / "data/source-ledger.json"
    payload = path.read_bytes()
    return json.loads(payload)["sources"], hashlib.sha256(payload).hexdigest()


def _value(item: dict[str, Any], key: str, default: Any = None) -> Any:
    value = item.get(key, default)
    return default if value is None and default is not None else value


def _natural_key(value: object) -> tuple[tuple[int, object], ...]:
    return tuple(
        (1, int(part)) if part.isdigit() else (0, part)
        for part in re.split(r"(\d+)", str(value or "").lower())
    )


def _insert_snapshots(connection: sqlite3.Connection, snapshots: list[Snapshot]) -> None:
    by_framework: dict[str, list[Snapshot]] = {}
    for snapshot in snapshots:
        by_framework.setdefault(snapshot["framework"], []).append(snapshot)
    for framework in sorted(by_framework):
        ordered = sorted(by_framework[framework], key=lambda item: (item["commit_date"], item["catalog_version"]))
        for version_ordinal, snapshot in enumerate(ordered):
            version = snapshot["catalog_version"]
            date = snapshot["commit_date"]
            connection.execute(
                "INSERT INTO catalog_versions VALUES (?, ?, ?, ?, ?)",
                (framework, version, date, None, version_ordinal),
            )
            groups = list(snapshot.get("groups", []))
            seen_groups: set[str] = set()
            for ordinal, group in enumerate(groups):
                group_id = str(group.get("id", ""))
                if not group_id or group_id in seen_groups:
                    raise ValueError(f"duplicate or empty group id in {framework}/{version}: {group_id!r}")
                seen_groups.add(group_id)
                connection.execute(
                    "INSERT INTO control_groups VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (framework, version, group_id, group.get("title"), group.get("overview"), group.get("parent_id"), ordinal),
                )
            raw_controls = snapshot.get("controls", {})
            controls = list(raw_controls.values()) if isinstance(raw_controls, dict) else list(raw_controls)
            controls.sort(key=lambda item: (
                _natural_key((item.get("metadata") or {}).get("sort_id") or item.get("id", "")),
                _natural_key(item.get("id", "")),
            ))
            seen_controls: set[str] = set()
            for ordinal, control in enumerate(controls):
                control_id = str(control.get("id", ""))
                if not control_id or control_id in seen_controls:
                    raise ValueError(f"duplicate or empty control id in {framework}/{version}: {control_id!r}")
                seen_controls.add(control_id)
                metadata = canonical_json(control.get("metadata", {}))
                applicability = canonical_json(control.get("applicability", [])) if control.get("applicability") is not None else None
                applicability_raw = canonical_json(control.get("applicability_raw", [])) if control.get("applicability_raw") is not None else None
                levels = sorted(set(control.get("e8_levels", [])))
                e8_levels = canonical_json(levels) if levels else None
                connection.execute(
                    "INSERT INTO control_history VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (framework, control_id, control.get("display_id"), control.get("label"), control.get("title"),
                     version, date, control.get("statement"), control.get("change_type", "new"),
                     control.get("section_id"), control.get("section_title"), metadata, applicability,
                     applicability_raw, e8_levels, control.get("updated"), control.get("guideline"),
                     _value(control, "control_class", "control"), _value(control, "source", "unknown"),
                     control.get("compliance"), control.get("revision"), control.get("change_complexity"), ordinal),
                )
                for level in levels:
                    connection.execute(
                        "INSERT INTO e8_mappings VALUES (?, ?, ?, ?, '')",
                        (framework, version, control_id, str(level)),
                    )
            raw_terms = snapshot.get("terms", {})
            terms = list(raw_terms.values()) if isinstance(raw_terms, dict) else list(raw_terms)
            terms.sort(key=lambda item: str(item.get("id") or item.get("term_id") or ""))
            seen_terms: set[str] = set()
            for ordinal, term in enumerate(terms):
                term_id = str(term.get("id") or term.get("term_id") or "")
                if not term_id or term_id in seen_terms:
                    raise ValueError(f"duplicate or empty term id in {framework}/{version}: {term_id!r}")
                seen_terms.add(term_id)
                connection.execute(
                    "INSERT INTO term_history VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (term_id, framework, term.get("term"), version, date, term.get("meaning"), term.get("change_type", "new"), ordinal),
                )


def _record_counts(connection: sqlite3.Connection) -> None:
    overall = (
        "annotations", "attack_mitigations", "attack_mitigation_techniques", "attack_releases",
        "attack_source_files", "attack_techniques", "catalog_versions", "control_attack_bridges",
        "control_attack_mappings", "control_groups", "control_history", "e8_mappings", "frameworks",
        "source_files", "term_history",
    )
    for table in overall:
        count = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        connection.execute("INSERT INTO build_counts VALUES (?, '', '', ?)", (table, count))
    versions = connection.execute("SELECT framework, version FROM catalog_versions ORDER BY framework, ordinal").fetchall()
    for framework, version in versions:
        for table, column in (("control_groups", "catalog_version"), ("control_history", "catalog_version"), ("term_history", "catalog_version")):
            count = connection.execute(
                f"SELECT COUNT(*) FROM {table} WHERE framework=? AND {column}=?", (framework, version)
            ).fetchone()[0]
            connection.execute("INSERT INTO build_counts VALUES (?, ?, ?, ?)", (table, framework, version, count))


def build_database(root: Path, output: Path, snapshots: list[Snapshot] | None = None) -> Path:
    root, output = root.resolve(), output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)
    sources, ledger_sha = _ledger(root)
    snapshots = snapshots if snapshots is not None else build_all_histories(root)
    annotation_path = root / "annotations/ism.json"
    annotation_manifest_path = root / "annotations/legacy-preservation.json"
    annotation_payload = load_annotation_cache(annotation_path)
    annotation_sha = hashlib.sha256(annotation_path.read_bytes()).hexdigest()
    annotation_manifest_sha = hashlib.sha256(annotation_manifest_path.read_bytes()).hexdigest()
    attack_source = next(
        source for source in sources if source["framework"] == "mitre-attack-enterprise"
    )
    attack_catalog = parse_attack_bundle(root / attack_source["path"])
    bridges_path = root / "mappings/ism-e8-attack-bridges.json"
    decisions_path = root / "mappings/ism-e8-attack-decisions.json"
    bridges_sha = hashlib.sha256(bridges_path.read_bytes()).hexdigest()
    decisions_sha = hashlib.sha256(decisions_path.read_bytes()).hexdigest()
    with sqlite3.connect(output) as connection:
        connection.execute("PRAGMA journal_mode=OFF")
        connection.execute("PRAGMA synchronous=OFF")
        connection.execute("PRAGMA temp_store=MEMORY")
        connection.execute("PRAGMA foreign_keys=ON")
        connection.executescript((root / "ingestion/schema.sql").read_text(encoding="utf-8"))
        connection.execute("BEGIN")
        connection.executemany("INSERT INTO frameworks VALUES (?, ?, ?, ?, ?, ?, ?)", FRAMEWORKS)
        _insert_snapshots(connection, snapshots)
        current_ism_version = connection.execute(
            "SELECT version FROM catalog_versions WHERE framework='ism' ORDER BY ordinal DESC LIMIT 1"
        ).fetchone()[0]
        allowed_controls = {
            row[0] for row in connection.execute(
                "SELECT DISTINCT control_id FROM e8_mappings WHERE framework='ism' AND catalog_version=?",
                (current_ism_version,),
            )
        }
        bridges, decisions, attack_mappings = load_and_expand_mappings(
            bridges_path, decisions_path, allowed_controls, attack_catalog
        )
        ism_source = next(
            source for source in sources
            if source["framework"] == "ism" and source["version"] == current_ism_version
        )
        control_statements = dict(connection.execute(
            "SELECT control_id, COALESCE(statement, '') FROM control_history "
            "WHERE framework='ism' AND catalog_version=?",
            (current_ism_version,),
        ))
        mitigations_by_id = {
            item["mitigation_id"]: item for item in attack_catalog["mitigations"]
        }
        techniques_by_id = {
            item["technique_id"]: item for item in attack_catalog["techniques"]
        }
        review_mappings = []
        for mapping in attack_mappings:
            statement = control_statements[mapping["control_id"]]
            mitigation = mitigations_by_id[mapping["mitigation_id"]]
            technique = techniques_by_id[mapping["technique_id"]]
            review_mappings.append({**mapping, "evidence": [*mapping["evidence"], {
                "kind": "ism-control",
                "framework": "ism",
                "catalog_version": current_ism_version,
                "control_id": mapping["control_id"],
                "source_sha256": ism_source["sha256"],
                "statement_sha256": hashlib.sha256(statement.encode()).hexdigest(),
            }, {
                "kind": "attack-mitigation",
                "attack_version": attack_catalog["version"],
                "mitigation_id": mitigation["mitigation_id"],
                "stix_id": mitigation["stix_id"],
                "url": mitigation["url"],
                "source_sha256": attack_source["sha256"],
            }, {
                "kind": "attack-technique-relationship",
                "technique_id": technique["technique_id"],
                "technique_stix_id": technique["stix_id"],
                "technique_url": technique["url"],
                "relationship_stix_id": mapping["relationship_stix_id"],
            }]})
        bridge_evidence = {}
        for bridge in bridges:
            statement = control_statements[bridge["control_id"]]
            mitigation = mitigations_by_id[bridge["mitigation_id"]]
            bridge_evidence[bridge["bridge_id"]] = [*bridge["evidence"], {
                "kind": "ism-control",
                "framework": "ism",
                "catalog_version": current_ism_version,
                "control_id": bridge["control_id"],
                "source_sha256": ism_source["sha256"],
                "statement_sha256": hashlib.sha256(statement.encode()).hexdigest(),
            }, {
                "kind": "attack-mitigation",
                "attack_version": attack_catalog["version"],
                "mitigation_id": mitigation["mitigation_id"],
                "stix_id": mitigation["stix_id"],
                "url": mitigation["url"],
                "source_sha256": attack_source["sha256"],
            }]
        connection.execute(
            "INSERT INTO attack_releases VALUES (?, ?, 'enterprise-attack', 0)",
            (attack_catalog["version"], attack_catalog["release_date"]),
        )
        connection.execute(
            "INSERT INTO attack_source_files VALUES (?, ?, ?, ?, ?)",
            (
                attack_source["path"], attack_source["version"], attack_source["date"],
                attack_source["origin"], attack_source["sha256"],
            ),
        )
        for technique in attack_catalog["techniques"]:
            connection.execute(
                "INSERT INTO attack_techniques VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    attack_catalog["version"], technique["technique_id"], technique["stix_id"],
                    technique["name"], technique["description"], technique["url"],
                    canonical_json(technique["tactics"]), canonical_json(technique["platforms"]),
                    technique["parent_technique_id"],
                ),
            )
        for mitigation in attack_catalog["mitigations"]:
            connection.execute(
                "INSERT INTO attack_mitigations VALUES (?, ?, ?, ?, ?, ?)",
                (
                    attack_catalog["version"], mitigation["mitigation_id"], mitigation["stix_id"],
                    mitigation["name"], mitigation["description"], mitigation["url"],
                ),
            )
        for bridge in bridges:
            connection.execute(
                "INSERT INTO control_attack_bridges VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    bridge["bridge_id"], "ism", current_ism_version, bridge["control_id"],
                    attack_catalog["version"], bridge["mitigation_id"], bridge["effect"],
                    bridge["confidence"], bridge["rationale"],
                    canonical_json(bridge_evidence[bridge["bridge_id"]]),
                ),
            )
        for relationship in attack_catalog["relationships"]:
            connection.execute(
                "INSERT INTO attack_mitigation_techniques VALUES (?, ?, ?, ?, ?)",
                (
                    attack_catalog["version"], relationship["mitigation_id"],
                    relationship["technique_id"], relationship["relationship_stix_id"],
                    relationship["description"],
                ),
            )
        for mapping in attack_mappings:
            connection.execute(
                "INSERT INTO control_attack_mappings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    mapping["bridge_id"], mapping["attack_version"], mapping["mitigation_id"],
                    mapping["technique_id"], mapping["status"],
                    mapping["rationale"] if mapping["status"] != "candidate" else None,
                    canonical_json(mapping["evidence"]) if mapping["status"] != "candidate" else None,
                    mapping["reviewed_by"], mapping["reviewed_at"],
                ),
            )
        for annotation in annotation_payload["annotations"]:
            connection.execute(
                "INSERT INTO annotations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    annotation["framework"], annotation["control_id"], annotation["catalog_version"],
                    annotation.get("input_sha256"), annotation["prompt_version"], annotation["model"],
                    annotation["ai_view"], annotation["ai_view_snarky"],
                    canonical_json(annotation.get("links", [])), canonical_json(annotation.get("impls", [])),
                    annotation["updated_at"],
                ),
            )
        for source in sorted(
            (item for item in sources if item["framework"] != "mitre-attack-enterprise"),
            key=lambda item: item["path"],
        ):
            connection.execute(
                "INSERT INTO source_files VALUES (?, ?, ?, ?, ?, ?)",
                (source["path"], source["framework"], source["version"], source["date"], source["origin"], source["sha256"]),
            )
        connection.executemany("INSERT INTO build_metadata VALUES (?, ?)", (
            ("annotation_cache_sha256", annotation_sha),
            ("annotation_legacy_manifest_sha256", annotation_manifest_sha),
            ("annotation_model", ANNOTATION_MODEL),
            ("annotation_prompt_version", ANNOTATION_PROMPT_VERSION),
            ("attack_bridge_sha256", bridges_sha),
            ("attack_decisions_sha256", decisions_sha),
            ("attack_source_sha256", attack_source["sha256"]),
            ("schema_version", "3"),
            ("sqlite_version", sqlite3.sqlite_version),
            ("source_ledger_sha256", ledger_sha),
        ))
        _record_counts(connection)
        connection.commit()
        connection.execute("VACUUM")
    write_review_artifacts(root, attack_catalog, bridges, review_mappings)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--output", type=Path, default=Path("build/rule1.sqlite3"))
    args = parser.parse_args()
    path = build_database(args.root, args.output)
    print(f"built {path} ({hashlib.sha256(path.read_bytes()).hexdigest()})")


if __name__ == "__main__":
    main()
