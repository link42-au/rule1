"""Validate Rule1 database provenance, schema, versions, counts, and integrity."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any

TABLES = (
    "build_counts", "build_metadata", "catalog_versions", "control_groups", "control_history",
    "e8_mappings", "frameworks", "source_files", "term_history",
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
        "framework_versions": versions,
        "row_counts": overall,
        "version_row_counts": version_counts,
    }


def write_contract(root: Path, database: Path, contract_path: Path) -> None:
    ledger_sha = _sha256(root / "data/source-ledger.json")
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
        contract = _database_contract(connection, ledger_sha)
    contract_path.write_text(json.dumps(contract, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def validate_database(root: Path, database: Path, contract_path: Path | None = None) -> None:
    root, database = root.resolve(), database.resolve()
    ledger_path = root / "data/source-ledger.json"
    ledger_payload = ledger_path.read_bytes()
    ledger = json.loads(ledger_payload)["sources"]
    ledger_sha = hashlib.sha256(ledger_payload).hexdigest()
    seen_paths: set[str] = set()
    expected_sources: list[tuple[str, str, str, str, str, str]] = []
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
        expected_sources.append((relative, source["framework"], source["version"], source["date"], source["origin"], source["sha256"]))
    expected_versions = sorted({(item["framework"], item["version"], item["date"]) for item in ledger})

    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
        tables = tuple(row[0] for row in connection.execute(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ))
        if tables != TABLES:
            raise ValueError(f"unexpected database tables: {tables}")
        if connection.execute("PRAGMA application_id").fetchone()[0] != 1381321777:
            raise ValueError("unexpected application_id")
        if connection.execute("PRAGMA user_version").fetchone()[0] != 1:
            raise ValueError("unexpected user_version")
        if connection.execute("PRAGMA page_size").fetchone()[0] != 4096:
            raise ValueError("unexpected page_size")
        metadata = dict(connection.execute("SELECT key, value FROM build_metadata"))
        if metadata != {"schema_version": "1", "source_ledger_sha256": ledger_sha, "sqlite_version": sqlite3.sqlite_version}:
            raise ValueError(f"unexpected build metadata: {metadata}")
        actual_sources = connection.execute(
            "SELECT path, framework, version, source_date, origin, sha256 FROM source_files ORDER BY path"
        ).fetchall()
        if actual_sources != sorted(expected_sources):
            raise ValueError("database provenance rows do not exactly match source ledger")
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
    args = parser.parse_args()
    if args.write_contract:
        write_contract(args.root.resolve(), args.database.resolve(), args.contract.resolve())
    validate_database(args.root, args.database, args.contract)
    print(f"validated {args.database}")


if __name__ == "__main__":
    main()
