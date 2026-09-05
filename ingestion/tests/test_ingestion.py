from __future__ import annotations

import copy
import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from rule1_ingest.build import _insert_attack_assessments, build_database
from rule1_ingest.parsers import (
    _changed,
    _canonical_nist_csf_id,
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
        expected = {"cyber-essentials": 3, "ism": 63, "nist-800-53": 4, "nist-csf": 2, "nzism": 8}
        self.assertEqual({key: len(value) for key, value in self.by_framework.items()}, expected)
        self.assertEqual(len(self.snapshots), 80)
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

    def test_nist_csf_zero_padding_preserves_control_lineage(self) -> None:
        old, current = self.by_framework["nist-csf"]
        self.assertEqual(_canonical_nist_csf_id("DE.AE-1"), "DE.AE-01")
        self.assertEqual(_canonical_nist_csf_id("DE.AE-10"), "DE.AE-10")
        self.assertNotIn("nist-csf-de.ae-1", old["controls"])
        self.assertNotIn("nist-csf-de.ae-1", current["controls"])
        self.assertEqual(old["controls"]["nist-csf-de.ae-01"]["display_id"], "DE.AE-1")
        self.assertEqual(current["controls"]["nist-csf-de.ae-01"]["display_id"], "DE.AE-01")
        self.assertEqual(current["controls"]["nist-csf-de.ae-01"]["change_type"], "modified")
        self.assertEqual(current["controls"]["nist-csf-de.ae-05"]["change_type"], "modified")
        self.assertEqual(current["controls"]["nist-csf-pr.ac-01"]["change_type"], "unchanged")
        self.assertEqual(sum(control["change_type"] == "new" for control in current["controls"].values()), 88)
        self.assertEqual(sum(control["change_type"] == "modified" for control in current["controls"].values()), 73)
        self.assertEqual(sum(control["change_type"] == "unchanged" for control in current["controls"].values()), 58)
        self.assertEqual(sum(control["change_type"] == "withdrawn" for control in current["controls"].values()), 0)

    def test_reviewed_parser_regressions(self) -> None:
        ism = self.by_framework["ism"]
        self.assertEqual(sum(len(item["controls"]) for item in ism), 54_030)
        self.assertEqual(len(ism[-1]["controls"]), 1_194)
        self.assertEqual(sum(len(item["terms"]) for item in ism), 4_063)
        self.assertEqual(len(ism[-1]["terms"]), 253)
        self.assertEqual(len(ism[-18]["groups"]), 481)
        self.assertEqual(len(ism[-1]["groups"]), 562)
        self.assertTrue(any(item["groups"] for item in ism))
        self.assertLessEqual(max(len(control["statement"]) for item in ism for control in item["controls"].values()), 2_000)
        self.assertTrue(any("C" in (control.get("applicability") or []) for item in ism for control in item["controls"].values()))
        self.assertTrue(any(control["change_type"] == "withdrawn"
                            for control in self.by_framework["nist-800-53"][-1]["controls"].values()))
        fallback = self.by_framework["nist-800-53"][0]["controls"].get("nist-800-53-ac-2.1")
        if fallback:
            self.assertEqual(fallback["display_id"], "AC-2(1)")

    def test_september_2026_oscal_is_the_current_complete_ism(self) -> None:
        current = self.by_framework["ism"][-1]
        self.assertEqual(current["catalog_version"], "ISM-OSCAL-2026.09.4")
        active = [control for control in current["controls"].values() if control["change_type"] != "withdrawn"]
        self.assertEqual(sum(control["control_class"] == "ISM-control" for control in active), 1_143)
        self.assertEqual(sum(control["control_class"] == "ISM-principle" for control in active), 49)
        self.assertEqual(current["controls"]["ism-2116"]["source"], "oscal")
        self.assertEqual(current["controls"]["ism-2124"]["source"], "oscal")
        self.assertEqual(current["controls"]["ism-principle-gov-01"]["display_id"], "GOV-01")
        self.assertEqual(current["controls"]["ism-0123"]["e8_levels"], ["ML2", "ML3"])
        self.assertEqual(current["controls"]["ism-1636"]["applicability"], ["NC", "OS", "P", "S"])
        self.assertEqual(
            current["controls"]["ism-2126"]["statement"],
            "Personnel positively identify requestors using a pre-established authentication method or "
            "independent trusted communication channel before actioning requests to modify user account "
            "details, modify banking details or conduct financial transactions.",
        )
        self.assertEqual(
            current["controls"]["ism-2162"]["statement"],
            "Unneeded components, services and functionality of network devices are disabled or removed.",
        )

    def test_september_oscal_records_authoritative_changes_from_june(self) -> None:
        june = self.by_framework["ism"][-2]
        current = self.by_framework["ism"][-1]
        self.assertEqual(june["catalog_version"], "ISM-OSCAL-2026.06.18")
        self.assertEqual(current["catalog_version"], "ISM-OSCAL-2026.09.4")

        oscal_path = ROOT / "data/ism-oscal/2026-09/ISM_catalog.json"
        metadata = json.loads(oscal_path.read_text(encoding="utf-8"))["catalog"]["metadata"]
        self.assertEqual(metadata["version"], "2026.09.4")
        self.assertEqual(metadata["last-modified"], "2026-09-03T23:10:47.63884244Z")
        self.assertEqual(metadata["oscal-version"], "1.1.2")
        self.assertEqual(oscal_path.stat().st_size, 2_677_748)

        june_0043 = june["controls"]["ism-0043"]
        oscal_0043 = current["controls"]["ism-0043"]
        canonical_oscal = _parse_ism_oscal(oscal_path)["controls"]["ism-0043"]["statement"]
        self.assertEqual(oscal_0043["statement"], canonical_oscal)
        self.assertEqual(june_0043["statement"], oscal_0043["statement"])
        self.assertEqual(oscal_0043["change_type"], "unchanged")

        controls = current["controls"]
        self.assertEqual(sum(control["change_type"] == "modified" and control["control_class"] == "ISM-control"
                             for control in controls.values()), 204)
        self.assertEqual(sum(control["change_type"] == "new" for control in controls.values()), 44)
        self.assertEqual(sum(control["change_type"] == "withdrawn" for control in controls.values()), 2)
        self.assertEqual(controls["ism-1372"]["change_type"], "modified")
        self.assertEqual(controls["ism-1372"]["revision"], "4")
        self.assertEqual(controls["ism-2162"]["change_type"], "new")
        self.assertEqual(controls["ism-2124"]["change_type"], "new")
        self.assertEqual(controls["ism-0521"]["change_type"], "withdrawn")
        self.assertEqual(controls["ism-1448"]["change_type"], "withdrawn")

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
            "2026-03": "2026.03.24", "2026-06": "2026.06.18", "2026-09": "2026.09.4",
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
            "2026-09": "42b282d739bf8eed397d35d191beb7b99b54e3961cff9cef0fef2f1e72f1f8b5",
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
        self.assertEqual(len(retained_pdfs), 45)
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

    def test_attack_schema_authorizes_only_control_to_mitigation_candidates(self) -> None:
        with sqlite3.connect(":memory:") as connection:
            connection.executescript((ROOT / "ingestion/schema.sql").read_text(encoding="utf-8"))
            tables = {row[0] for row in connection.execute(
                "SELECT name FROM sqlite_schema WHERE type='table'"
            )}
            self.assertIn("control_attack_assessments", tables)
            self.assertIn("control_attack_mitigation_mappings", tables)
            self.assertNotIn("control_attack_bridges", tables)
            self.assertNotIn("control_attack_mappings", tables)
            mapping_columns = {row[1] for row in connection.execute(
                "PRAGMA table_info(control_attack_mitigation_mappings)"
            )}
            self.assertIn("mitigation_id", mapping_columns)
            self.assertIn("security_function", mapping_columns)
            self.assertNotIn("technique_id", mapping_columns)
            self.assertNotIn("effect", mapping_columns)

            provenance = ("model", "prompt-v1", "a" * 64, "2026-09-05T00:00:00Z")
            payload = {"assessments": [{
                "control_id": "ism-0001", "disposition": "mapped", "unmapped_reason": None,
                "provenance": dict(zip(
                    ("model", "prompt_version", "input_sha256", "generated_at"), provenance,
                    strict=True,
                )),
                "candidates": [{
                    "candidate_id": "candidate-1", "mitigation_id": "M1001",
                    "relationship": "enables", "security_function": "protect",
                    "confidence": "high", "status": "candidate",
                    "rationale": "Control-specific rationale",
                    "evidence": [{"kind": "ism-control"}],
                    "reviewed_by": None, "reviewed_at": None,
                }],
            }]}
            _insert_attack_assessments(
                connection, payload, "ISM-OSCAL-2026.09.4", "19.2"
            )
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    "INSERT INTO control_attack_mitigation_mappings VALUES "
                    "('candidate-2','ism','ISM-OSCAL-2026.09.4','ism-0001','19.2','M1002',"
                    "'mitigates','prevent','high','candidate','Invalid semantics',"
                    "'[{\"kind\":\"ism-control\"}]',NULL,NULL)"
                )
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    "INSERT INTO control_attack_assessments VALUES "
                    "('ism','ISM-OSCAL-2026.09.4','ism-0002','19.2','unmapped',NULL,?,?,?,?)",
                    provenance,
                )
            invalid_partition = copy.deepcopy(payload)
            invalid_partition["assessments"][0]["candidates"] = []
            with self.assertRaisesRegex(ValueError, "disposition does not match"):
                _insert_attack_assessments(
                    connection, invalid_partition, "ISM-OSCAL-2026.09.4", "19.2"
                )

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
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 6)
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchall(), [("ok",)])
            self.assertEqual(
                dict(connection.execute("SELECT key, value FROM build_metadata"))["sqlite_version"],
                sqlite3.sqlite_version,
            )
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM catalog_versions").fetchone()[0], 80)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM source_files").fetchone()[0], 82)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM attack_source_files").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM attack_techniques").fetchone()[0], 697)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM attack_mitigations").fetchone()[0], 44)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM attack_mitigation_techniques").fetchone()[0], 1_448)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM attack_procedure_entities").fetchone()[0], 1_057)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM attack_procedures").fetchone()[0], 17_136)
            self.assertEqual(
                dict(connection.execute(
                    "SELECT entity_type, COUNT(*) FROM attack_procedure_entities GROUP BY entity_type"
                )),
                {"intrusion-set": 176, "campaign": 56, "malware": 730, "tool": 95},
            )
            self.assertEqual(
                dict(connection.execute(
                    "SELECT e.entity_type, COUNT(*) FROM attack_procedures p "
                    "JOIN attack_procedure_entities e USING (attack_version, entity_stix_id) "
                    "GROUP BY e.entity_type"
                )),
                {"intrusion-set": 4_628, "campaign": 1_146, "malware": 10_493, "tool": 869},
            )
            self.assertEqual(connection.execute(
                "SELECT COUNT(DISTINCT technique_id) FROM attack_procedures"
            ).fetchone()[0], 611)
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM attack_procedures WHERE json_array_length(external_references)=0"
            ).fetchone()[0], 15)
            procedure = connection.execute(
                "SELECT p.relationship_stix_id, e.entity_stix_id, e.external_id, e.url, "
                "p.description, p.external_references FROM attack_procedures p "
                "JOIN attack_procedure_entities e USING (attack_version, entity_stix_id) "
                "WHERE json_array_length(p.external_references)>0 "
                "ORDER BY p.technique_id, e.entity_type, e.name, p.relationship_stix_id LIMIT 1"
            ).fetchone()
            self.assertTrue(procedure[0].startswith("relationship--"))
            self.assertIn("--", procedure[1])
            self.assertRegex(procedure[2], r"^[CGS]\d{4}$")
            self.assertRegex(procedure[3], r"^https://attack\.mitre\.org/")
            self.assertTrue(procedure[4].strip())
            self.assertTrue(json.loads(procedure[5])[0]["source_name"])
            entity_references = json.loads(connection.execute(
                "SELECT external_references FROM attack_procedure_entities "
                "WHERE entity_type='intrusion-set' ORDER BY external_id LIMIT 1"
            ).fetchone()[0])
            self.assertTrue(any(
                reference["source_name"] == "mitre-attack"
                and reference["external_id"].startswith("G")
                and reference["url"].startswith("https://attack.mitre.org/groups/")
                for reference in entity_references
            ))
            self.assertGreater(connection.execute(
                "SELECT MAX(example_count) FROM (SELECT COUNT(*) AS example_count "
                "FROM attack_procedures GROUP BY technique_id)"
            ).fetchone()[0], 5)
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM control_attack_assessments"
            ).fetchone()[0], 1_143)
            self.assertGreater(connection.execute(
                "SELECT COUNT(*) FROM control_attack_mitigation_mappings"
            ).fetchone()[0], 0)
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM control_attack_mitigation_mappings "
                "WHERE relationship!='enables' OR security_function NOT IN ('protect','detect','recover')"
            ).fetchone()[0], 0)
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM control_attack_mitigation_mappings WHERE status!='candidate'"
            ).fetchone()[0], 0)
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM control_attack_assessments a WHERE "
                "(a.disposition='mapped') != EXISTS (SELECT 1 "
                "FROM control_attack_mitigation_mappings m WHERE m.framework=a.framework "
                "AND m.ism_catalog_version=a.ism_catalog_version AND m.control_id=a.control_id "
                "AND m.attack_version=a.attack_version)"
            ).fetchone()[0], 0)
            mapping_schema = connection.execute(
                "SELECT sql FROM sqlite_schema WHERE type='table' "
                "AND name='control_attack_mitigation_mappings'"
            ).fetchone()[0]
            self.assertIn("relationship = 'enables'", mapping_schema)
            self.assertNotIn("technique_id", mapping_schema)
            indexes = {row[0] for row in connection.execute(
                "SELECT name FROM sqlite_schema WHERE type='index'"
            )}
            self.assertTrue({
                "idx_attack_technique_parent", "idx_attack_relationship_technique",
                "idx_attack_procedure_entity_name", "idx_attack_procedure_technique",
                "idx_attack_procedure_entity",
                "idx_attack_assessment_disposition", "idx_attack_mapping_mitigation",
                "idx_attack_mapping_status",
            }.issubset(indexes))
            connection.execute("PRAGMA foreign_keys=ON")
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    "INSERT INTO control_attack_mitigation_mappings VALUES "
                    "('invalid-candidate','ism','ISM-OSCAL-2026.09.4','ism-0001','19.2',"
                    "'M9999','enables','protect','high','candidate','Specific rationale',"
                    "'[{\"kind\":\"test\"}]',NULL,NULL)"
                )
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    "INSERT INTO attack_procedures VALUES "
                    "('19.2','relationship--orphan','malware--absent','T1110',"
                    "'Orphan procedure example','[]')"
                )
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM term_history").fetchone()[0], 4_063)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM annotations").fetchone()[0], 1_146)
            annotation = connection.execute(
                "SELECT catalog_version, ai_view, ai_view_snarky FROM annotations "
                "WHERE framework='ism' AND control_id='ism-0043'"
            ).fetchone()
            self.assertEqual(annotation[0], "ISM-OSCAL-2026.09.4")
            self.assertIn("incident response plan", annotation[1].lower())
            self.assertIn("plan sits on a shelf", annotation[2])
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM e8_mappings WHERE framework='ism' AND catalog_version='ISM-OSCAL-2026.09.4'"
            ).fetchone()[0], 256)
            ordered_controls = connection.execute(
                "SELECT control_id FROM control_history WHERE framework='ism' "
                "AND catalog_version='ISM-OSCAL-2026.09.4' ORDER BY ordinal LIMIT 3"
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
