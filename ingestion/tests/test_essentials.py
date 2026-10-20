"""Focused regression tests for lossless Essentials OSCAL parsing."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from rule1_ingest.essentials import ESSENTIALS_NS, load_domain_profiles, parse_essentials_catalog, parse_essentials_snapshot


class EssentialsTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.tmp_path = Path(temporary.name)

    def test_preserves_domains_indicators_and_unknown_extensions(self) -> None:
        tmp_path = self.tmp_path
        indicator = {"name": "item", "class": "fully-effective-indicator-statement", "prose": "Evidence"}
        control = {
            "id": "ACT-1",
            "title": "Protect access",
            "props": [
                {"ns": ESSENTIALS_NS, "name": "domain", "value": "identity-services"},
                {"ns": ESSENTIALS_NS, "name": "future-extension", "value": "retain-me"},
            ],
            "parts": [{"name": "statement", "class": "essentials-action", "parts": [indicator]}],
            "links": [{"rel": "mitigated-technique", "href": "https://example.org/technique"}],
        }
        catalog = {"metadata": {"title": "ASD Essentials", "version": "2026.10.15"},
                   "groups": [{"id": "P-1", "class": "essentials-principle",
                               "title": "Access", "controls": [control]}]}
        path = tmp_path / "catalog.json"
        path.write_text(json.dumps({"catalog": catalog}), encoding="utf-8")
        result = parse_essentials_catalog(path)
        self.assertEqual(result["principles"][0]["id"], "P-1")
        action = result["actions"][0]
        self.assertEqual(action["principle"], "P-1")
        self.assertEqual(action["domains"], ["identity-services"])
        self.assertEqual(action["parts"][0]["parts"][0], indicator)
        self.assertEqual(action["props"][1]["value"], "retain-me")
        self.assertEqual(result["catalog"], catalog)

    def test_rejects_missing_actions(self) -> None:
        tmp_path = self.tmp_path
        path = tmp_path / "empty.json"
        path.write_text(json.dumps({"catalog": {"metadata": {"title": "Empty"}}}))
        with self.assertRaisesRegex(ValueError, "no actions"):
            parse_essentials_catalog(path)

    def test_rejects_duplicate_action_ids(self) -> None:
        tmp_path = self.tmp_path
        path = tmp_path / "duplicate.json"
        path.write_text(json.dumps({"catalog": {
            "metadata": {"title": "Duplicate"},
            "controls": [{"id": "A"}, {"id": "A"}],
        }}))
        with self.assertRaisesRegex(ValueError, "duplicate"):
            parse_essentials_catalog(path)

    def test_official_catalog_snapshot(self) -> None:
        """The committed ASD release is the acceptance fixture, not synthetic data."""
        root = Path(__file__).resolve().parents[2]
        path = root / "data/essentials/E4EIT_catalog-2026.10.15.json"
        parsed = parse_essentials_catalog(path)
        snapshot = parse_essentials_snapshot(path, root / "ingestion/sources/essentials")
        self.assertEqual(parsed["metadata"]["version"], "2026.10.15")
        self.assertEqual(len(parsed["actions"]), 58)
        self.assertEqual(len(parsed["principles"]), 28)
        self.assertEqual(len(snapshot["controls"]), 58)
        self.assertEqual(len(snapshot["groups"]), 33)
        self.assertTrue(all(item["metadata"]["oscal"] for item in snapshot["controls"].values()))
        domains = load_domain_profiles(root / "ingestion/sources/essentials", "2026.10.15")
        self.assertEqual(len(domains), 8)
        first = snapshot["controls"]["IT.GOV-01.1"]["metadata"]
        self.assertEqual(first["essentials"]["ancestors"][-1]["id"], "GOV-01")
        self.assertEqual(first["essentials"]["domains"][0]["phases"], ["phase-1", "phase-2", "phase-3"])
        self.assertEqual(first["essentials"]["catalog_metadata"], parsed["metadata"])
        for action in parsed["actions"]:
            retained = snapshot["controls"][action["id"]]["metadata"]["oscal"]
            self.assertEqual(retained, action["raw"])
        self.assertEqual(list(snapshot["controls"]), [a["id"] for a in parsed["actions"]])

    def test_supporting_sources_reject_tampering_and_missing_files(self) -> None:
        root = Path(__file__).resolve().parents[2]
        archive = self.tmp_path / "archive"
        shutil.copytree(root / "ingestion/sources/essentials", archive)
        profile = archive / "E4EIT_identity-services-domain_profile.json"
        profile.write_bytes(profile.read_bytes() + b" ")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            load_domain_profiles(archive, "2026.10.15")
        profile.unlink()
        with self.assertRaisesRegex(ValueError, "file set mismatch"):
            load_domain_profiles(archive, "2026.10.15")

    def test_nested_controls_groups_and_unknown_metadata_are_lossless(self) -> None:
        child = {"id": "SECOND", "props": [{"ns": "https://example.test/future", "name": "future", "value": "retained"}],
                 "parts": [{"name": "statement", "class": "future-part", "parts": [{"name": "item", "prose": "nested evidence"}]}]}
        control = {"id": "FIRST", "controls": [child], "links": [{"href": "https://example.test/reference", "rel": "future"}]}
        catalog = {"metadata": {"title": "Nested"}, "groups": [{"id": "outer", "groups": [
            {"id": "principle", "class": "essentials-principle", "controls": [control]}]}]}
        path = self.tmp_path / "nested.json"
        path.write_text(json.dumps({"catalog": catalog}))
        parsed = parse_essentials_catalog(path)
        self.assertEqual([a["id"] for a in parsed["actions"]], ["FIRST", "SECOND"])
        self.assertEqual(parsed["actions"][1]["principle"], "principle")
        self.assertEqual(parsed["actions"][1]["raw"], child)
        snapshot = parse_essentials_snapshot(path)
        self.assertEqual(snapshot["controls"]["SECOND"]["metadata"]["oscal"], child)
        self.assertEqual([g["id"] for g in snapshot["groups"]], ["outer", "principle"])

    def test_malformed_nested_extensions_fail_closed(self) -> None:
        cases = [
            {"parts": [{"name": "statement", "parts": {"invalid": True}}]},
            {"parts": [{"name": "statement", "prose": []}]},
            {"props": [{"name": "domain", "value": ["invalid"]}]},
            {"links": [{"href": 42}]},
            {"controls": [{"id": "A"}]},
        ]
        for extension in cases:
            with self.subTest(extension=extension):
                path = self.tmp_path / "invalid.json"
                path.write_text(json.dumps({"catalog": {"metadata": {"title": "Invalid"}, "controls": [{"id": "A", **extension}]}}))
                with self.assertRaises(ValueError):
                    parse_essentials_catalog(path)

    def test_duplicate_groups_are_rejected(self) -> None:
        path = self.tmp_path / "duplicate-groups.json"
        path.write_text(json.dumps({"catalog": {"metadata": {"title": "Invalid"}, "groups": [
            {"id": "same", "controls": [{"id": "A"}]}, {"id": "same"}]}}))
        with self.assertRaisesRegex(ValueError, "duplicate OSCAL group"):
            parse_essentials_catalog(path)
