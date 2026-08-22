from __future__ import annotations

import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from rule1_ingest.build import build_database
from rule1_ingest.parsers import _parse_ce, build_all_histories
from rule1_ingest.validate import validate_database, write_contract

ROOT = Path(__file__).resolve().parents[2]


class ParserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.snapshots = build_all_histories(ROOT)
        cls.by_framework = {
            framework: [item for item in cls.snapshots if item["framework"] == framework]
            for framework in {item["framework"] for item in cls.snapshots}
        }

    def test_all_retained_versions_have_stable_unique_controls(self) -> None:
        expected = {"cyber-essentials": 3, "ism": 60, "nist-800-53": 4, "nist-csf": 2, "nzism": 8}
        self.assertEqual({key: len(value) for key, value in self.by_framework.items()}, expected)
        self.assertEqual(len(self.snapshots), 77)
        for snapshot in self.snapshots:
            controls = snapshot["controls"]
            self.assertTrue(controls, snapshot["catalog_version"])
            self.assertEqual(len(controls), len(set(controls)), snapshot["catalog_version"])
            self.assertTrue(all(control["change_type"] in {"new", "modified", "unchanged", "withdrawn"}
                                for control in controls.values()))

    def test_representative_record_for_each_framework(self) -> None:
        prefixes = {
            "cyber-essentials": "ce-", "ism": "ism-", "nist-800-53": "nist-800-53-",
            "nist-csf": "nist-csf-", "nzism": "nzism-",
        }
        for framework, prefix in prefixes.items():
            controls = self.by_framework[framework][-1]["controls"]
            representative = next(control for key, control in sorted(controls.items()) if key.startswith(prefix))
            self.assertTrue(representative["display_id"])
            self.assertIn("statement", representative)
            self.assertIn("control_class", representative)

    def test_reviewed_parser_regressions(self) -> None:
        ism = self.by_framework["ism"]
        self.assertEqual(sum(len(item["controls"]) for item in ism), 50_624)
        self.assertEqual(len(ism[-1]["controls"]), 1_150)
        self.assertTrue(any(item["groups"] for item in ism))
        self.assertLessEqual(max(len(control["statement"]) for item in ism for control in item["controls"].values()), 2_000)
        self.assertTrue(any("C" in (control.get("applicability") or []) for item in ism for control in item["controls"].values()))
        self.assertTrue(any(control["change_type"] == "withdrawn"
                            for control in self.by_framework["nist-800-53"][-1]["controls"].values()))
        fallback = self.by_framework["nist-800-53"][0]["controls"].get("nist-800-53-ac-2.1")
        if fallback:
            self.assertEqual(fallback["display_id"], "AC-2(1)")

    def test_june_2026_is_the_current_complete_ism(self) -> None:
        current = self.by_framework["ism"][-1]
        self.assertEqual(current["catalog_version"], "ISM-OSCAL-2026.06.18")
        active = [control for control in current["controls"].values() if control["change_type"] != "withdrawn"]
        self.assertEqual(sum(control["control_class"] == "ISM-control" for control in active), 1_101)
        self.assertEqual(sum(control["control_class"] == "ISM-principle" for control in active), 49)
        self.assertEqual(current["controls"]["ism-2116"]["source"], "oscal")
        self.assertIn("ism-2118", current["controls"])
        self.assertEqual(current["controls"]["ism-principle-gov-01"]["display_id"], "GOV-01")
        self.assertEqual(current["controls"]["ism-0123"]["e8_levels"], ["ML2", "ML3"])

    def test_pdf_to_oscal_boundary_records_real_changes(self) -> None:
        march = self.by_framework["ism"][-2]
        controls = list(march["controls"].values())
        self.assertEqual(sum(control["change_type"] == "modified" for control in controls), 17)
        self.assertEqual(sum(control["change_type"] == "new" and control["control_class"] == "ISM-control"
                             for control in controls), 9)
        self.assertEqual(sum(control["change_type"] == "new" and control["control_class"] == "ISM-principle"
                             for control in controls), 49)
        self.assertEqual(sum(control["change_type"] == "withdrawn" for control in controls), 1)
        self.assertEqual(march["controls"]["ism-1906"]["change_type"], "unchanged")

    def test_official_ism_oscal_metadata_versions(self) -> None:
        expected = {"2026-03": "2026.03.24", "2026-06": "2026.06.18"}
        for directory, version in expected.items():
            path = ROOT / "data/ism-oscal" / directory / "ISM_catalog.json"
            catalog = json.loads(path.read_text(encoding="utf-8"))["catalog"]
            self.assertEqual(catalog["metadata"]["version"], version)

    def test_duplicate_source_control_ids_fail(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "duplicate.json"
            path.write_text(json.dumps({"groups": [], "controls": [{"id": "ce-x"}, {"id": "ce-x"}]}))
            with self.assertRaisesRegex(ValueError, "duplicate"):
                _parse_ce(path)


class DatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.snapshots = ParserTests.snapshots if hasattr(ParserTests, "snapshots") else build_all_histories(ROOT)

    def test_two_clean_builds_are_byte_identical_and_valid(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.sqlite3"
            second = Path(directory) / "second.sqlite3"
            build_database(ROOT, first)
            build_database(ROOT, second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(hashlib.sha256(first.read_bytes()).hexdigest(), hashlib.sha256(second.read_bytes()).hexdigest())
            validate_database(ROOT, first, ROOT / "ingestion/validation-contract.json")

    def test_schema_versions_counts_and_integrity(self) -> None:
        database = ROOT / "build/rule1.sqlite3"
        if not database.exists():
            build_database(ROOT, database, self.snapshots)
        validate_database(ROOT, database, ROOT / "ingestion/validation-contract.json")
        with sqlite3.connect(database) as connection:
            self.assertEqual(connection.execute("PRAGMA application_id").fetchone()[0], 1_381_321_777)
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 1)
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchall(), [("ok",)])
            self.assertEqual(
                dict(connection.execute("SELECT key, value FROM build_metadata"))["sqlite_version"],
                sqlite3.sqlite_version,
            )
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM catalog_versions").fetchone()[0], 77)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM source_files").fetchone()[0], 79)
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM e8_mappings WHERE framework='ism' AND catalog_version='ISM-OSCAL-2026.06.18'"
            ).fetchone()[0], 256)
        with tempfile.TemporaryDirectory() as directory:
            generated_contract = Path(directory) / "validation-contract.json"
            write_contract(ROOT, database, generated_contract)
            contract = json.loads(generated_contract.read_text(encoding="utf-8"))
            self.assertNotIn("sqlite_version", contract)


if __name__ == "__main__":
    unittest.main()
