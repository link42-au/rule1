from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path

from rule1_ingest.attack import (
    ATTACK_RELEASE_DATE,
    ATTACK_VERSION,
    ISM_VERSION,
    expand_mappings,
    load_bridges,
    load_decisions,
    parse_attack_bundle,
    review_artifacts,
    write_review_artifacts,
)


def attack_object(
    object_type: str,
    stix_id: str,
    external_id: str,
    *,
    revoked: bool = False,
    deprecated: bool = False,
    subtechnique: bool = False,
) -> dict[str, object]:
    prefix = "techniques" if object_type == "attack-pattern" else "mitigations"
    value: dict[str, object] = {
        "type": object_type,
        "id": stix_id,
        "name": f"Name {external_id}",
        "description": f"Description {external_id}",
        "revoked": revoked,
        "x_mitre_deprecated": deprecated,
        "external_references": [{
            "source_name": "mitre-attack",
            "external_id": external_id,
            "url": f"https://attack.mitre.org/{prefix}/{external_id.replace('.', '/')}/",
        }],
    }
    if object_type == "attack-pattern":
        value.update({
            "x_mitre_is_subtechnique": subtechnique,
            "x_mitre_platforms": ["Windows", "Linux", "Windows"],
            "kill_chain_phases": [
                {"kill_chain_name": "mitre-attack", "phase_name": "execution"},
                {"kill_chain_name": "other", "phase_name": "ignored"},
            ],
        })
    return value


def relationship(
    stix_id: str,
    relationship_type: str,
    source_ref: str,
    target_ref: str,
    *,
    revoked: bool = False,
) -> dict[str, object]:
    return {
        "type": "relationship",
        "id": stix_id,
        "relationship_type": relationship_type,
        "source_ref": source_ref,
        "target_ref": target_ref,
        "description": f"Evidence for {stix_id}",
        "revoked": revoked,
    }


def bundle_fixture() -> dict[str, object]:
    parent = "attack-pattern--parent"
    child = "attack-pattern--child"
    old = "attack-pattern--old"
    mitigation_one = "course-of-action--one"
    mitigation_two = "course-of-action--two"
    mitigation_old = "course-of-action--old"
    return {"type": "bundle", "objects": [
        attack_object("attack-pattern", child, "T1000.001", subtechnique=True),
        attack_object("course-of-action", mitigation_two, "M1002"),
        attack_object("attack-pattern", old, "T9999", revoked=True),
        attack_object("attack-pattern", parent, "T1000"),
        attack_object("course-of-action", mitigation_one, "M1001"),
        attack_object("course-of-action", mitigation_old, "M1999", deprecated=True),
        relationship("relationship--parent", "subtechnique-of", child, parent),
        relationship("relationship--one-parent", "mitigates", mitigation_one, parent),
        relationship("relationship--one-child", "mitigates", mitigation_one, child),
        relationship("relationship--two-parent", "mitigates", mitigation_two, parent),
        relationship("relationship--old-technique", "mitigates", mitigation_one, old),
        relationship("relationship--old-mitigation", "mitigates", mitigation_old, parent),
        relationship(
            "relationship--revoked", "mitigates", mitigation_two, child, revoked=True
        ),
        {"type": "malware", "id": "malware--ignored", "name": "Ignored"},
    ]}


def bridge_fixture() -> dict[str, object]:
    return {
        "version": 1,
        "unmapped": [{"control_id": "ism-0003", "reason": "No direct bridge."}],
        "bridges": [
            {
                "control_ids": ["ism-0002", "ism-0001"],
                "mitigation_id": "M1001",
                "effect": "prevent",
                "confidence": "high",
                "rationale": "The control enforces the mitigation.",
                "evidence": [
                    {"kind": "attack", "note": "ATT&CK M1001"},
                    {"kind": "source", "url": "https://example.test/bridge"},
                ],
            },
            {
                "bridge_id": "explicit-detect-bridge",
                "control_id": "ism-0001",
                "mitigation_id": "M1002",
                "effect": "detect",
                "confidence": "medium",
                "rationale": "The control helps detect the activity.",
                "evidence": [{"kind": "attack", "note": "ATT&CK M1002"}],
            },
        ],
    }


class AttackParserTests(unittest.TestCase):
    def test_parser_preserves_active_catalog_and_relationship_fields(self) -> None:
        catalog = parse_attack_bundle(bundle_fixture())
        self.assertEqual(catalog["version"], ATTACK_VERSION)
        self.assertEqual(catalog["release_date"], ATTACK_RELEASE_DATE)
        self.assertEqual(
            [item["technique_id"] for item in catalog["techniques"]],
            ["T1000", "T1000.001"],
        )
        self.assertEqual(
            [item["mitigation_id"] for item in catalog["mitigations"]],
            ["M1001", "M1002"],
        )
        child = catalog["techniques"][1]
        self.assertEqual(child["parent_technique_id"], "T1000")
        self.assertEqual(child["tactics"], ["execution"])
        self.assertEqual(child["platforms"], ["Linux", "Windows"])
        self.assertEqual(child["description"], "Description T1000.001")
        self.assertEqual(
            child["url"], "https://attack.mitre.org/techniques/T1000/001/"
        )
        self.assertEqual(
            [(item["mitigation_id"], item["technique_id"]) for item in catalog["relationships"]],
            [("M1001", "T1000"), ("M1001", "T1000.001"), ("M1002", "T1000")],
        )
        self.assertEqual(
            catalog["relationships"][0]["relationship_stix_id"],
            "relationship--one-parent",
        )

    def test_parser_output_is_deterministic_regardless_of_bundle_order(self) -> None:
        fixture = bundle_fixture()
        reversed_fixture = copy.deepcopy(fixture)
        reversed_fixture["objects"] = list(reversed(reversed_fixture["objects"]))
        self.assertEqual(parse_attack_bundle(fixture), parse_attack_bundle(reversed_fixture))

    def test_parser_rejects_missing_external_identity_and_duplicates(self) -> None:
        missing_reference = bundle_fixture()
        missing_reference["objects"][0]["external_references"] = []
        with self.assertRaisesRegex(ValueError, "no MITRE ATT&CK external reference"):
            parse_attack_bundle(missing_reference)

        duplicate = bundle_fixture()
        duplicate["objects"].append(copy.deepcopy(duplicate["objects"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate ATT&CK technique STIX id"):
            parse_attack_bundle(duplicate)


class AttackMappingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.catalog = parse_attack_bundle(bundle_fixture())
        self.allowed_controls = {"ism-0001", "ism-0002", "ism-0003"}

    def test_many_to_many_expansion_defaults_to_candidate_and_applies_exact_decisions(self) -> None:
        bridges = load_bridges(bridge_fixture(), self.allowed_controls, self.catalog)
        self.assertEqual(
            [item["bridge_id"] for item in bridges],
            [
                "explicit-detect-bridge",
                "ism-e8-0001-m1001-prevent",
                "ism-e8-0002-m1001-prevent",
            ],
        )
        decisions = load_decisions({"decisions": [
            {
                "bridge_id": "ism-e8-0001-m1001-prevent",
                "technique_id": "T1000.001",
                "status": "reviewed",
                "rationale": "Reviewed specifically for the sub-technique.",
                "evidence": [{"kind": "review", "note": "review record 1"}],
                "reviewed_by": "Reviewer One",
                "reviewed_at": "2026-09-04",
            },
            {
                "bridge_id": "ism-e8-0002-m1001-prevent",
                "technique_id": "T1000",
                "status": "rejected",
                "rationale": "This technique is outside the control scope.",
                "evidence": [{"kind": "review", "note": "review record 2"}],
                "reviewed_by": "Reviewer Two",
                "reviewed_at": "2026-09-04",
            },
        ]}, bridges, self.catalog)
        mappings = expand_mappings(bridges, decisions, self.catalog)

        self.assertEqual(len(mappings), 5)
        self.assertEqual(
            {(item["control_id"], item["technique_id"], item["effect"]) for item in mappings},
            {
                ("ism-0001", "T1000", "detect"),
                ("ism-0001", "T1000", "prevent"),
                ("ism-0001", "T1000.001", "prevent"),
                ("ism-0002", "T1000", "prevent"),
                ("ism-0002", "T1000.001", "prevent"),
            },
        )
        by_key = {(item["bridge_id"], item["technique_id"]): item for item in mappings}
        reviewed = by_key[("ism-e8-0001-m1001-prevent", "T1000.001")]
        self.assertEqual(reviewed["status"], "reviewed")
        self.assertEqual(reviewed["reviewed_by"], "Reviewer One")
        self.assertEqual(reviewed["rationale"], "Reviewed specifically for the sub-technique.")
        self.assertEqual(
            by_key[("ism-e8-0002-m1001-prevent", "T1000")]["status"], "rejected"
        )
        self.assertEqual(by_key[("explicit-detect-bridge", "T1000")]["status"], "candidate")
        self.assertTrue(all(item["framework"] == "ism" for item in mappings))
        self.assertTrue(all(item["ism_catalog_version"] == ISM_VERSION for item in mappings))
        self.assertTrue(all(item["attack_version"] == ATTACK_VERSION for item in mappings))

    def test_bridge_and_mapping_output_is_deterministic(self) -> None:
        original = bridge_fixture()
        reordered = copy.deepcopy(original)
        reordered["bridges"] = list(reversed(reordered["bridges"]))
        reordered["bridges"][1]["control_ids"] = list(
            reversed(reordered["bridges"][1]["control_ids"])
        )
        first = load_bridges(original, self.allowed_controls, self.catalog)
        second = load_bridges(reordered, self.allowed_controls, self.catalog)
        self.assertEqual(first, second)
        self.assertEqual(expand_mappings(first, [], self.catalog), expand_mappings(second, [], self.catalog))

    def test_bridge_validation_rejects_invalid_values(self) -> None:
        mutations = [
            ("unknown or non-E8 control", {"control_ids": ["ism-9999"]}),
            ("unknown mitigation", {"mitigation_id": "M9999"}),
            ("malformed effect", {"effect": "stop"}),
            ("malformed confidence", {"confidence": "certain"}),
            ("blank or missing rationale", {"rationale": " "}),
            ("blank or missing evidence", {"evidence": []}),
            ("non-empty objects", {"evidence": ["not structured"]}),
            ("blank or missing kind", {"evidence": [{"kind": ""}]}),
            ("duplicate control_ids entry", {"control_ids": ["ism-0001", "ism-0001"]}),
            ("duplicate evidence entry", {"evidence": [
                {"kind": "source", "note": "same"},
                {"kind": "source", "note": "same"},
            ]}),
        ]
        for expected, changes in mutations:
            fixture = bridge_fixture()
            fixture["bridges"] = [{**fixture["bridges"][0], **changes}]
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, expected):
                load_bridges(fixture, self.allowed_controls, self.catalog)

        duplicate = bridge_fixture()
        duplicate["bridges"].append(copy.deepcopy(duplicate["bridges"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate mapping bridge"):
            load_bridges(duplicate, self.allowed_controls, self.catalog)

        wrong_version = bridge_fixture()
        wrong_version["attack_version"] = "19.1"
        with self.assertRaisesRegex(ValueError, "attack_version must be 19.2"):
            load_bridges(wrong_version, self.allowed_controls, self.catalog)

    def test_bridge_document_requires_exact_disjoint_e8_control_partition(self) -> None:
        missing = bridge_fixture()
        missing["unmapped"] = []
        with self.assertRaisesRegex(ValueError, "coverage must equal allowed controls"):
            load_bridges(missing, self.allowed_controls, self.catalog)

        overlap = bridge_fixture()
        overlap["unmapped"] = [{"control_id": "ism-0001", "reason": "Incorrect overlap."}]
        with self.assertRaisesRegex(ValueError, "both bridged and unmapped"):
            load_bridges(overlap, self.allowed_controls, self.catalog)

        duplicate = bridge_fixture()
        duplicate["unmapped"].append(copy.deepcopy(duplicate["unmapped"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate unmapped control"):
            load_bridges(duplicate, self.allowed_controls, self.catalog)

        blank_reason = bridge_fixture()
        blank_reason["unmapped"][0]["reason"] = ""
        with self.assertRaisesRegex(ValueError, "blank or missing reason"):
            load_bridges(blank_reason, self.allowed_controls, self.catalog)

    def test_decision_validation_rejects_orphans_duplicates_and_malformed_reviews(self) -> None:
        bridges = load_bridges(bridge_fixture(), self.allowed_controls, self.catalog)
        valid = {
            "bridge_id": "ism-e8-0001-m1001-prevent",
            "technique_id": "T1000",
            "status": "reviewed",
            "rationale": "Reviewed rationale.",
            "evidence": [{"kind": "review", "note": "review evidence"}],
            "reviewed_by": "Reviewer",
            "reviewed_at": "2026-09-04",
        }
        invalid_cases = [
            ({**valid, "bridge_id": "missing"}, "unknown bridge"),
            ({**valid, "technique_id": "T9999"}, "unknown technique"),
            ({**valid, "bridge_id": "explicit-detect-bridge", "technique_id": "T1000.001"},
             "does not match a mitigation relationship"),
            ({**valid, "status": "candidate"}, "malformed status"),
            ({**valid, "reviewed_by": ""}, "blank reviewed_by"),
            ({**valid, "reviewed_at": ""}, "blank reviewed_at"),
            ({**valid, "rationale": ""}, "blank or missing rationale"),
            ({**valid, "evidence": []}, "blank or missing evidence"),
        ]
        for decision, expected in invalid_cases:
            with self.subTest(decision=decision), self.assertRaisesRegex(ValueError, expected):
                load_decisions({"decisions": [decision]}, bridges, self.catalog)

        rejected = {**valid, "status": "rejected"}
        self.assertEqual(load_decisions({"decisions": [rejected]}, bridges, self.catalog)[0]["status"], "rejected")
        rejected_without_reviewer = {**rejected, "reviewed_by": None}
        with self.assertRaisesRegex(ValueError, "requires reviewed_by and reviewed_at"):
            load_decisions({"decisions": [rejected_without_reviewer]}, bridges, self.catalog)
        with self.assertRaisesRegex(ValueError, "duplicate mapping decision"):
            load_decisions({"decisions": [valid, copy.deepcopy(valid)]}, bridges, self.catalog)

        with self.assertRaisesRegex(ValueError, "ism_catalog_version must be"):
            load_decisions(
                {"ism_catalog_version": "old", "decisions": [valid]}, bridges, self.catalog
            )

    def test_review_artifacts_are_deterministic_and_navigator_is_reviewed_only(self) -> None:
        bridges = load_bridges(bridge_fixture(), self.allowed_controls, self.catalog)
        decisions = load_decisions({"decisions": [{
            "bridge_id": "ism-e8-0001-m1001-prevent",
            "technique_id": "T1000.001",
            "status": "reviewed",
            "rationale": "The reviewed edge applies specifically.",
            "evidence": [{"kind": "review", "note": "review evidence"}],
            "reviewed_by": "Reviewer",
            "reviewed_at": "2026-09-04",
        }]}, bridges, self.catalog)
        mappings = expand_mappings(bridges, decisions, self.catalog)
        report, navigator = review_artifacts(self.catalog, bridges, mappings)

        self.assertEqual(report["counts"]["bridges"], 3)
        self.assertEqual(report["counts"]["by_status"], {
            "candidate": 4, "rejected": 0, "reviewed": 1,
        })
        self.assertEqual(report["mappings"][0]["technique_stix_id"], "attack-pattern--parent")
        self.assertEqual(report["mappings"][0]["mitigation_name"], "Name M1002")
        self.assertEqual(navigator["domain"], "enterprise-attack")
        self.assertEqual(navigator["versions"]["layer"], "4.5")
        self.assertEqual([item["techniqueID"] for item in navigator["techniques"]], ["T1000.001"])
        self.assertIn("may prevent", navigator["techniques"][0]["comment"])
        self.assertNotIn("defeat", str(navigator).lower())

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = write_review_artifacts(root, self.catalog, bridges, mappings)
            first = [path.read_bytes() for path in paths]
            self.assertTrue(all(value.endswith(b"\n") for value in first))
            second_paths = write_review_artifacts(root, self.catalog, bridges, mappings)
            self.assertEqual([path.read_bytes() for path in second_paths], first)


if __name__ == "__main__":
    unittest.main()
