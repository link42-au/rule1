from __future__ import annotations

import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from rule1_ingest.build import build_database
from rule1_ingest.parsers import (
    _changed,
    _ism_guideline_title,
    _parse_ce,
    _parse_ism_oscal,
    build_all_histories,
)
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
        expected = {"cyber-essentials": 3, "ism": 62, "nist-800-53": 4, "nist-csf": 2, "nzism": 8}
        self.assertEqual({key: len(value) for key, value in self.by_framework.items()}, expected)
        self.assertEqual(len(self.snapshots), 79)
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
        self.assertEqual(sum(len(item["controls"]) for item in ism), 52_836)
        self.assertEqual(len(ism[-1]["controls"]), 1_150)
        self.assertEqual(sum(len(item["terms"]) for item in ism), 3_810)
        self.assertEqual(len(ism[-1]["terms"]), 248)
        self.assertEqual(len(ism[-17]["groups"]), 481)
        self.assertEqual(len(ism[-1]["groups"]), 550)
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
        june_2022 = next(item for item in self.by_framework["ism"]
                         if item["catalog_version"] == "ISM-OSCAL-2022.09.14")
        controls = list(june_2022["controls"].values())
        self.assertEqual(sum(control["change_type"] == "modified" for control in controls), 28)
        self.assertEqual(sum(control["change_type"] == "new" and control["control_class"] == "ISM-control"
                             for control in controls), 6)
        self.assertEqual(sum(control["change_type"] == "new" and control["control_class"] == "ISM-principle"
                             for control in controls), 24)
        self.assertEqual(sum(control["change_type"] == "withdrawn" for control in controls), 3)
        self.assertEqual(june_2022["controls"]["ism-0027"]["change_type"], "unchanged")
        all_applicability = next(control for control in controls if control["applicability_raw"] == ["ALL"])
        self.assertEqual(all_applicability["applicability"], ["NC", "OS", "P", "S", "TS"])

    def test_official_ism_oscal_metadata_versions(self) -> None:
        expected = {
            "2022-06": "2022.09.14", "2022-09": "2022.09.15", "2022-12": "2022.12.1",
            "2023-03": "2023.04.12", "2023-06": "2023.08.3", "2023-09": "2023.09.25",
            "2023-12": "2023.12.1", "2024-03": "2024.03.12", "2024-06": "2024.06.18",
            "2024-09": "2024.10.4", "2024-12": "2024.12.19", "2025-03": "2025.03.31",
            "2025-06": "2025.07.16", "2025-09": "2025.10.8", "2025-12": "2025.12.9",
            "2026-03": "2026.03.24", "2026-06": "2026.06.18",
        }
        profile_verified_e8_digests = {
            "2022-06": "06513f48efc0570ab68e79061ebb98bde95ce87f77e53ec59e3b3853496f07e2",
            "2022-09": "06513f48efc0570ab68e79061ebb98bde95ce87f77e53ec59e3b3853496f07e2",
            "2022-12": "1ab48760ef3d400ac2efdd4a3ddeedd9d8a5ad401343b7c2b7816bab4e5be3d4",
            "2023-03": "9ede27a2ce8fbaca6ab82fa0a3f5608d4f3fc66926a1aba6d3efe24f908d32e5",
            "2023-06": "fd7c97e6f4063402076f5cf2f89ad06e14ccbd5ea46c81a6b747153da827e1cf",
            "2023-09": "3962fe899a1ec48ce9cf09868d7324af55f5b6ff3cdfb0b5c9da39e2214a645a",
            "2023-12": "42b282d739bf8eed397d35d191beb7b99b54e3961cff9cef0fef2f1e72f1f8b5",
            "2024-03": "42b282d739bf8eed397d35d191beb7b99b54e3961cff9cef0fef2f1e72f1f8b5",
            "2024-06": "42b282d739bf8eed397d35d191beb7b99b54e3961cff9cef0fef2f1e72f1f8b5",
            "2024-09": "42b282d739bf8eed397d35d191beb7b99b54e3961cff9cef0fef2f1e72f1f8b5",
            "2024-12": "42b282d739bf8eed397d35d191beb7b99b54e3961cff9cef0fef2f1e72f1f8b5",
            "2025-03": "42b282d739bf8eed397d35d191beb7b99b54e3961cff9cef0fef2f1e72f1f8b5",
            "2025-06": "42b282d739bf8eed397d35d191beb7b99b54e3961cff9cef0fef2f1e72f1f8b5",
            "2025-09": "42b282d739bf8eed397d35d191beb7b99b54e3961cff9cef0fef2f1e72f1f8b5",
            "2025-12": "42b282d739bf8eed397d35d191beb7b99b54e3961cff9cef0fef2f1e72f1f8b5",
            "2026-03": "42b282d739bf8eed397d35d191beb7b99b54e3961cff9cef0fef2f1e72f1f8b5",
            "2026-06": "42b282d739bf8eed397d35d191beb7b99b54e3961cff9cef0fef2f1e72f1f8b5",
        }
        for directory, version in expected.items():
            path = ROOT / "data/ism-oscal" / directory / "ISM_catalog.json"
            catalog = json.loads(path.read_text(encoding="utf-8"))["catalog"]
            self.assertEqual(catalog["metadata"]["version"], version)
            parsed = _parse_ism_oscal(path)
            mapping = {
                control_id: control["e8_levels"]
                for control_id, control in sorted(parsed["controls"].items())
                if control["e8_levels"]
            }
            mapping_digest = hashlib.sha256(
                json.dumps(mapping, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest()
            self.assertEqual(mapping_digest, profile_verified_e8_digests[directory])
        ledger = json.loads((ROOT / "data/source-ledger.json").read_text(encoding="utf-8"))["sources"]
        retained_pdfs = [item for item in ledger if item["framework"] == "ism" and item["path"].endswith(".pdf")]
        self.assertEqual(retained_pdfs[-1]["version"], "ISM-PDF-2022-03")
        self.assertEqual(len(expected), sum(item["framework"] == "ism" and item["path"].endswith(".json")
                                            for item in ledger))

    def test_original_oscal_parser_behaviour_is_retained(self) -> None:
        ism_ns_v1 = "https://cyber.gov.au/ns/ism/oscal/1.0"
        ism_ns_v2 = "https://cyber.gov.au/ns/ism/oscal/2.0"
        ism_ns_v3 = "https://cyber.gov.au/ns/ism/oscal/3.0"
        uuid = "11111111-2222-3333-4444-555555555555"
        catalog = {
            "catalog": {
                "groups": [
                    {
                        "title": "Guidelines for network management",
                        "groups": [
                            {"title": "Purpose"},
                            {
                                "title": "Cyber Security Policy",
                                "controls": [
                                    {
                                        "id": "ism-0001",
                                        "class": "ISM-control",
                                        "props": [
                                            {"name": "sort-id", "value": "catalog[1].group[2].control[1]"},
                                            {"name": "applicability", "value": "P", "ns": "https://example.com"},
                                            {"name": "revision", "value": "2", "ns": ism_ns_v1},
                                            {"name": "updated", "value": "Sep-22", "ns": ism_ns_v2},
                                            {"name": "essential-eight-applicability", "value": "ML2", "ns": ism_ns_v3},
                                            {"name": "essential-eight-applicability", "value": "ML3", "ns": "https://example.com"},
                                        ],
                                        "parts": [{
                                            "name": "statement",
                                            "prose": f"Use [this control](#{uuid}) and [external guidance](https://example.com).",
                                        }],
                                        "controls": [{
                                            "id": "ism-0002",
                                            "class": "ISM-control",
                                            "props": [
                                                {"name": "applicability", "value": "P", "ns": ism_ns_v3},
                                            ],
                                            "parts": [{"name": "statement", "prose": "Nested control."}],
                                        }],
                                    }
                                ],
                            },
                        ],
                    },
                    {
                        "title": "Glossary of Cyber Security Terms",
                        "parts": [{
                            "name": "overview",
                            "prose": "| Term | Meaning |\n|---|---|\n| Access Control | Restricts access. |\n",
                        }],
                    },
                ]
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ISM_catalog.json"
            path.write_text(json.dumps(catalog), encoding="utf-8")
            parsed = _parse_ism_oscal(path)

        self.assertEqual(set(parsed["controls"]), {"ism-0001", "ism-0002"})
        control = parsed["controls"]["ism-0001"]
        self.assertEqual(control["applicability"], ["NC", "OS", "P", "S", "TS"])
        self.assertEqual(control["applicability_raw"], [])
        self.assertEqual(control["revision"], "2")
        self.assertEqual(control["updated"], "Sep-22")
        self.assertEqual(control["guideline"], "Network Management")
        self.assertEqual(control["e8_levels"], ["ML2"])
        self.assertEqual(control["metadata"]["sort_id"], "catalog[1].group[2].control[1]")
        self.assertIn("this control", control["statement"])
        self.assertNotIn(f"](#{uuid})", control["statement"])
        self.assertIn("[external guidance](https://example.com)", control["statement"])
        self.assertEqual(parsed["controls"]["ism-0002"]["applicability"], ["P"])
        group_ids = {group["id"] for group in parsed["groups"]}
        self.assertIn("guidelines-for-network-management/cybersecurity-policy", group_ids)
        self.assertNotIn("guidelines-for-network-management/purpose", group_ids)
        self.assertEqual(parsed["groups"][0]["title"], "Network Management")
        self.assertEqual(parsed["terms"]["access-control"]["meaning"], "Restricts access.")

    def test_revision_only_metadata_change_is_unchanged(self) -> None:
        current = {
            "source": "oscal", "statement": "Do this.", "applicability": ["OS"],
            "revision": "2", "updated": "Jun-26",
        }
        previous = {**current, "revision": "1", "updated": "Mar-26"}
        self.assertEqual(_changed(current, previous), "unchanged")
        self.assertEqual(
            _ism_guideline_title("Guidelines for cyber security incidents"),
            "Cybersecurity Incidents",
        )

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
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM catalog_versions").fetchone()[0], 79)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM source_files").fetchone()[0], 81)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM term_history").fetchone()[0], 3_810)
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM e8_mappings WHERE framework='ism' AND catalog_version='ISM-OSCAL-2026.06.18'"
            ).fetchone()[0], 256)
            ordered_controls = connection.execute(
                "SELECT control_id FROM control_history WHERE framework='ism' "
                "AND catalog_version='ISM-OSCAL-2026.06.18' ORDER BY ordinal LIMIT 3"
            ).fetchall()
            self.assertEqual(ordered_controls, [
                ("ism-principle-gov-01",), ("ism-principle-gov-08",), ("ism-principle-gov-02",),
            ])
        with tempfile.TemporaryDirectory() as directory:
            generated_contract = Path(directory) / "validation-contract.json"
            write_contract(ROOT, database, generated_contract)
            contract = json.loads(generated_contract.read_text(encoding="utf-8"))
            self.assertNotIn("sqlite_version", contract)


if __name__ == "__main__":
    unittest.main()
