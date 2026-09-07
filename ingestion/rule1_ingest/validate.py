"""Validate Rule1 database provenance, schema, versions, counts, and integrity."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any

from .annotations import LEGACY_MANIFEST_SHA256
from .mitigation_mappings import load_assessments, load_inputs

TABLES = (
    "annotations", "attack_mitigation_techniques", "attack_mitigations", "attack_procedure_entities",
    "attack_procedures", "attack_releases", "attack_source_files", "attack_techniques",
    "build_counts", "build_metadata", "catalog_versions", "control_attack_assessments",
    "control_attack_mitigation_mappings", "control_groups", "control_history", "e8_mappings",
    "frameworks", "source_files", "term_history",
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _schema_fingerprint(connection: sqlite3.Connection) -> str:
    rows = connection.execute(
        "SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
    ).fetchall()
    canonical = "\n".join("\t".join(str(value or "") for value in row) for row in rows)
    return hashlib.sha256(canonical.encode()).hexdigest()


def _database_contract(connection: sqlite3.Connection, ledger_sha: str) -> dict[str, Any]:
    versions: dict[str, list[str]] = {}
    for framework, version in connection.execute(
        "SELECT framework, version FROM catalog_versions ORDER BY framework, ordinal"
    ):
        versions.setdefault(framework, []).append(version)
    overall = {
        table: count for table, count in connection.execute(
            "SELECT table_name, row_count FROM build_counts WHERE framework='' AND catalog_version='' ORDER BY table_name"
        )
    }
    version_counts: dict[str, dict[str, dict[str, int]]] = {}
    for table, framework, version, count in connection.execute(
        "SELECT table_name, framework, catalog_version, row_count FROM build_counts "
        "WHERE framework<>'' ORDER BY framework, catalog_version, table_name"
    ):
        version_counts.setdefault(framework, {}).setdefault(version, {})[table] = count
    return {
        "format_version": 1,
        "application_id": connection.execute("PRAGMA application_id").fetchone()[0],
        "user_version": connection.execute("PRAGMA user_version").fetchone()[0],
        "page_size": connection.execute("PRAGMA page_size").fetchone()[0],
        "source_ledger_sha256": ledger_sha,
        "schema_sha256": _schema_fingerprint(connection),
        "tables": list(TABLES),
        "attack_versions": [row[0] for row in connection.execute(
            "SELECT version FROM attack_releases ORDER BY ordinal"
        )],
        "attack_mapping_status_counts": {
            status: count for status, count in connection.execute(
                "SELECT status, COUNT(*) FROM control_attack_mitigation_mappings "
                "GROUP BY status ORDER BY status"
            )
        },
        "attack_assessment_disposition_counts": {
            disposition: count for disposition, count in connection.execute(
                "SELECT disposition, COUNT(*) FROM control_attack_assessments "
                "GROUP BY disposition ORDER BY disposition"
            )
        },
        "framework_versions": versions,
        "row_counts": overall,
        "version_row_counts": version_counts,
    }


def write_contract(root: Path, database: Path, contract_path: Path) -> None:
    ledger_sha = _sha256(root / "data/source-ledger.json")
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
        contract = _database_contract(connection, ledger_sha)
    contract_path.write_text(json.dumps(contract, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def validate_database(
    root: Path,
    database: Path,
    contract_path: Path | None = None,
    *,
    require_complete_annotations: bool = False,
) -> None:
    root, database = root.resolve(), database.resolve()
    ledger_path = root / "data/source-ledger.json"
    ledger_payload = ledger_path.read_bytes()
    ledger = json.loads(ledger_payload)["sources"]
    ledger_sha = hashlib.sha256(ledger_payload).hexdigest()
    seen_paths: set[str] = set()
    expected_sources: list[tuple[str, str, str, str, str, str]] = []
    expected_attack_sources: list[tuple[str, str, str, str, str]] = []
    root_real = root.resolve()
    for source in ledger:
        required = ("path", "framework", "version", "date", "origin", "sha256")
        if any(not source.get(field) for field in required):
            raise ValueError(f"source ledger row is missing a required field: {source}")
        relative = source["path"]
        if relative in seen_paths:
            raise ValueError(f"duplicate source ledger path: {relative}")
        seen_paths.add(relative)
        candidate = root / relative
        if candidate.is_symlink():
            raise ValueError(f"source must not be a symlink: {relative}")
        path = candidate.resolve()
        try:
            path.relative_to(root_real)
        except ValueError as error:
            raise ValueError(f"source escapes repository: {relative}") from error
        if not path.is_file():
            raise ValueError(f"source is not a regular committed file: {relative}")
        actual_sha = _sha256(path)
        if actual_sha != source["sha256"]:
            raise ValueError(f"source checksum mismatch: {relative}")
        if source["framework"] == "mitre-attack-enterprise":
            expected_attack_sources.append(
                (relative, source["version"], source["date"], source["origin"], source["sha256"])
            )
        else:
            expected_sources.append((relative, source["framework"], source["version"], source["date"], source["origin"], source["sha256"]))
    expected_versions = sorted({
        (item["framework"], item["version"], item["date"])
        for item in ledger if item["framework"] != "mitre-attack-enterprise"
    })

    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
        tables = tuple(row[0] for row in connection.execute(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ))
        if tables != TABLES:
            raise ValueError(f"unexpected database tables: {tables}")
        if connection.execute("PRAGMA application_id").fetchone()[0] != 1381321777:
            raise ValueError("unexpected application_id")
        if connection.execute("PRAGMA user_version").fetchone()[0] != 6:
            raise ValueError("unexpected user_version")
        if connection.execute("PRAGMA page_size").fetchone()[0] != 4096:
            raise ValueError("unexpected page_size")
        metadata = dict(connection.execute("SELECT key, value FROM build_metadata"))
        annotation_path = root / "annotations/ism.json"
        annotation_manifest_path = root / "annotations/legacy-preservation.json"
        annotation_sha = _sha256(annotation_path)
        annotation_manifest_sha = _sha256(annotation_manifest_path)
        assessments_path = root / "mappings/ism-attack-mitigation-assessments.json"
        attack_source = next(
            item for item in ledger if item["framework"] == "mitre-attack-enterprise"
        )
        if annotation_manifest_sha != LEGACY_MANIFEST_SHA256:
            raise ValueError("legacy annotation preservation manifest checksum mismatch")
        expected_metadata = {
            "annotation_cache_sha256": annotation_sha,
            "annotation_legacy_manifest_sha256": annotation_manifest_sha,
            "annotation_model": "nvidia/nemotron-3-ultra-550b-a55b:free",
            "annotation_prompt_version": "legacy-rule1-v1",
            "attack_mitigation_assessments_sha256": _sha256(assessments_path),
            "attack_source_sha256": attack_source["sha256"],
            "schema_version": "6",
            "source_ledger_sha256": ledger_sha,
            "sqlite_version": sqlite3.sqlite_version,
        }
        if metadata != expected_metadata:
            raise ValueError(f"unexpected build metadata: {metadata}")
        cache_payload = json.loads(annotation_path.read_text(encoding="utf-8"))
        preservation_payload = json.loads(annotation_manifest_path.read_text(encoding="utf-8"))
        cache_by_id = {row["control_id"]: row for row in cache_payload["annotations"]}
        for record in preservation_payload["rows"]:
            if record["disposition"] != "preserve":
                continue
            cached = cache_by_id.get(record["control_id"])
            if cached is None:
                raise ValueError(f"preserved legacy annotation is missing: {record['control_id']}")
            pair = json.dumps(
                [cached["ai_view"], cached["ai_view_snarky"]],
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
            if hashlib.sha256(pair.encode()).hexdigest() != record["description_sha256"]:
                raise ValueError(f"preserved legacy annotation changed: {record['control_id']}")
        expected_annotations = sorted((
            row["framework"], row["control_id"], row["catalog_version"], row.get("input_sha256"),
            row["prompt_version"], row["model"], row["ai_view"], row["ai_view_snarky"],
            json.dumps(row.get("links", []), ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            json.dumps(row.get("impls", []), ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            row["updated_at"],
        ) for row in cache_payload["annotations"])
        actual_annotations = connection.execute(
            "SELECT framework, control_id, catalog_version, input_sha256, prompt_version, model, "
            "ai_view, ai_view_snarky, links, impls, updated_at FROM annotations ORDER BY framework, control_id"
        ).fetchall()
        if actual_annotations != expected_annotations:
            raise ValueError("database annotations do not exactly match the committed cache")
        invalid_annotations = connection.execute(
            "SELECT COUNT(*) FROM annotations WHERE framework!='ism' OR TRIM(ai_view)='' "
            "OR TRIM(ai_view_snarky)='' OR TRIM(prompt_version)='' OR TRIM(model)='' "
            "OR json_valid(links)=0 OR json_valid(impls)=0"
        ).fetchone()[0]
        if invalid_annotations:
            raise ValueError(f"invalid annotation rows: {invalid_annotations}")
        orphan_annotations = connection.execute(
            "SELECT COUNT(*) FROM annotations a WHERE NOT EXISTS ("
            "SELECT 1 FROM control_history h WHERE h.framework=a.framework AND h.control_id=a.control_id)"
        ).fetchone()[0]
        if orphan_annotations:
            raise ValueError(f"orphan annotation rows: {orphan_annotations}")
        if require_complete_annotations:
            incomplete = connection.execute(
                "WITH current_ism AS (SELECT version FROM catalog_versions WHERE framework='ism' ORDER BY ordinal DESC LIMIT 1) "
                "SELECT COUNT(*) FROM control_history h LEFT JOIN annotations a "
                "ON a.framework=h.framework AND a.control_id=h.control_id "
                "WHERE h.framework='ism' AND h.catalog_version=(SELECT version FROM current_ism) "
                "AND h.control_class='ISM-control' AND h.change_type!='withdrawn' "
                "AND (a.control_id IS NULL OR a.catalog_version!=h.catalog_version OR a.input_sha256 IS NULL)"
            ).fetchone()[0]
            if incomplete:
                raise ValueError(f"current ISM annotations are incomplete or stale: {incomplete}")
        actual_sources = connection.execute(
            "SELECT path, framework, version, source_date, origin, sha256 FROM source_files ORDER BY path"
        ).fetchall()
        if actual_sources != sorted(expected_sources):
            raise ValueError("database provenance rows do not exactly match source ledger")
        actual_attack_sources = connection.execute(
            "SELECT path, version, source_date, origin, sha256 FROM attack_source_files ORDER BY path"
        ).fetchall()
        if actual_attack_sources != sorted(expected_attack_sources):
            raise ValueError("database ATT&CK provenance rows do not exactly match source ledger")
        attack_releases = connection.execute(
            "SELECT version, release_date, domain FROM attack_releases ORDER BY ordinal"
        ).fetchall()
        if attack_releases != [("19.2", "2026-08-06", "enterprise-attack")]:
            raise ValueError(f"unexpected ATT&CK releases: {attack_releases}")
        invalid_attack_rows = connection.execute(
            "SELECT (SELECT COUNT(*) FROM attack_techniques WHERE TRIM(technique_id)='' "
            "OR TRIM(stix_id)='' OR TRIM(name)='' OR TRIM(url)='' OR json_valid(tactics)=0 "
            "OR json_valid(platforms)=0) + "
            "(SELECT COUNT(*) FROM attack_mitigations WHERE TRIM(mitigation_id)='' "
            "OR TRIM(stix_id)='' OR TRIM(name)='' OR TRIM(url)='') + "
            "(SELECT COUNT(*) FROM attack_mitigation_techniques WHERE TRIM(relationship_stix_id)='') + "
            "(SELECT COUNT(*) FROM attack_procedure_entities WHERE TRIM(entity_stix_id)='' "
            "OR entity_type NOT IN ('intrusion-set','campaign','malware','tool') "
            "OR TRIM(name)='' OR TRIM(description)='' OR json_valid(external_references)=0 "
            "OR json_type(external_references)!='array' OR (url IS NOT NULL "
            "AND url NOT LIKE 'https://%' AND url NOT LIKE 'http://%')) + "
            "(SELECT COUNT(*) FROM attack_procedures WHERE TRIM(relationship_stix_id)='' "
            "OR TRIM(entity_stix_id)='' OR TRIM(technique_id)='' OR TRIM(description)='' "
            "OR json_valid(external_references)=0 OR json_type(external_references)!='array')"
        ).fetchone()[0]
        if invalid_attack_rows:
            raise ValueError(f"invalid ATT&CK rows: {invalid_attack_rows}")
        invalid_assessments = connection.execute(
            "SELECT COUNT(*) FROM control_attack_assessments WHERE framework!='ism' "
            "OR ism_catalog_version!='ISM-OSCAL-2026.09.4' OR attack_version!='19.2' "
            "OR disposition NOT IN ('mapped','unmapped') OR TRIM(model)='' "
            "OR TRIM(prompt_version)='' OR length(input_sha256)!=64 OR TRIM(generated_at)='' "
            "OR (disposition='mapped' AND unmapped_reason IS NOT NULL) "
            "OR (disposition='unmapped' AND TRIM(COALESCE(unmapped_reason,''))='')"
        ).fetchone()[0]
        if invalid_assessments:
            raise ValueError(f"invalid control-to-ATT&CK assessments: {invalid_assessments}")
        invalid_mappings = connection.execute(
            "SELECT COUNT(*) FROM control_attack_mitigation_mappings WHERE framework!='ism' "
            "OR ism_catalog_version!='ISM-OSCAL-2026.09.4' OR attack_version!='19.2' "
            "OR TRIM(candidate_id)='' OR relationship!='enables' "
            "OR security_function NOT IN ('protect','detect','recover') "
            "OR TRIM(rationale)='' OR json_valid(evidence)=0 OR json_array_length(evidence)=0 "
            "OR (status='candidate' AND (reviewed_by IS NOT NULL OR reviewed_at IS NOT NULL)) "
            "OR (status IN ('reviewed','rejected') AND (reviewed_by IS NULL OR reviewed_at IS NULL))"
        ).fetchone()[0]
        if invalid_mappings:
            raise ValueError(f"invalid control-to-ATT&CK mappings: {invalid_mappings}")
        control_contexts, mitigations = load_inputs(root)
        mapping_payload = load_assessments(
            assessments_path, control_contexts, mitigations
        )
        expected_assessments = []
        expected_mappings = []
        for assessment in mapping_payload["assessments"]:
            provenance = assessment["provenance"]
            expected_assessments.append((
                "ism", "ISM-OSCAL-2026.09.4", assessment["control_id"], "19.2",
                assessment["disposition"], assessment["unmapped_reason"], provenance["model"],
                provenance["prompt_version"], provenance["input_sha256"],
                provenance["generated_at"],
            ))
            for mapping in assessment["candidates"]:
                expected_mappings.append((
                    mapping["candidate_id"], "ism", "ISM-OSCAL-2026.09.4",
                    assessment["control_id"], "19.2", mapping["mitigation_id"],
                    mapping["relationship"], mapping["security_function"], mapping["confidence"],
                    mapping["status"], mapping["rationale"],
                    json.dumps(mapping["evidence"], ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                    mapping["reviewed_by"], mapping["reviewed_at"],
                ))
        actual_assessments = connection.execute(
            "SELECT framework, ism_catalog_version, control_id, attack_version, disposition, "
            "unmapped_reason, model, prompt_version, input_sha256, generated_at "
            "FROM control_attack_assessments ORDER BY control_id"
        ).fetchall()
        if actual_assessments != sorted(expected_assessments, key=lambda row: row[2]):
            raise ValueError("database assessments do not exactly match authored input")
        actual_mappings = connection.execute(
            "SELECT candidate_id, framework, ism_catalog_version, control_id, attack_version, "
            "mitigation_id, relationship, security_function, confidence, status, rationale, "
            "evidence, reviewed_by, reviewed_at FROM control_attack_mitigation_mappings "
            "ORDER BY candidate_id"
        ).fetchall()
        if actual_mappings != sorted(expected_mappings, key=lambda row: row[0]):
            raise ValueError("database mappings do not exactly match authored mitigation candidates")
        active_controls = connection.execute(
            "SELECT control_id FROM control_history WHERE framework='ism' "
            "AND catalog_version='ISM-OSCAL-2026.09.4' AND control_class='ISM-control' "
            "AND change_type!='withdrawn' ORDER BY control_id"
        ).fetchall()
        assessed_controls = connection.execute(
            "SELECT control_id FROM control_attack_assessments ORDER BY control_id"
        ).fetchall()
        if assessed_controls != active_controls:
            raise ValueError("ATT&CK assessments do not partition every active ISM control exactly once")
        disposition_mismatches = connection.execute(
            "SELECT COUNT(*) FROM control_attack_assessments a WHERE "
            "(a.disposition='mapped') != EXISTS (SELECT 1 FROM control_attack_mitigation_mappings m "
            "WHERE m.framework=a.framework AND m.ism_catalog_version=a.ism_catalog_version "
            "AND m.control_id=a.control_id AND m.attack_version=a.attack_version)"
        ).fetchone()[0]
        if disposition_mismatches:
            raise ValueError(f"assessment disposition mismatches: {disposition_mismatches}")
        actual_versions = connection.execute(
            "SELECT framework, version, commit_date FROM catalog_versions ORDER BY framework, version, commit_date"
        ).fetchall()
        if actual_versions != expected_versions:
            raise ValueError("database framework versions do not exactly match source ledger")
        for table, framework, version, expected_count in connection.execute(
            "SELECT table_name, framework, catalog_version, row_count FROM build_counts ORDER BY 1,2,3"
        ):
            if framework:
                version_column = "version" if table == "catalog_versions" else "catalog_version"
                actual_count = connection.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE framework=? AND {version_column}=?", (framework, version)
                ).fetchone()[0]
            else:
                actual_count = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            if actual_count != expected_count:
                raise ValueError(f"row count mismatch for {table}/{framework}/{version}: {actual_count} != {expected_count}")
        if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("PRAGMA integrity_check failed")
        foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
        if foreign_key_errors:
            raise ValueError(f"PRAGMA foreign_key_check failed: {foreign_key_errors}")
        if contract_path is not None:
            expected_contract = json.loads(contract_path.read_text(encoding="utf-8"))
            actual_contract = _database_contract(connection, ledger_sha)
            if actual_contract != expected_contract:
                raise ValueError("database does not match ingestion/validation-contract.json")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--database", type=Path, default=Path("build/rule1.sqlite3"))
    parser.add_argument("--contract", type=Path, default=Path("ingestion/validation-contract.json"))
    parser.add_argument("--write-contract", action="store_true")
    parser.add_argument("--require-complete-annotations", action="store_true")
    args = parser.parse_args()
    if args.write_contract:
        write_contract(args.root.resolve(), args.database.resolve(), args.contract.resolve())
    validate_database(
        args.root,
        args.database,
        args.contract,
        require_complete_annotations=args.require_complete_annotations,
    )
    print(f"validated {args.database}")


if __name__ == "__main__":
    main()
