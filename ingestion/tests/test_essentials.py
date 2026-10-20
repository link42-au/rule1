"""Focused regression tests for lossless Essentials OSCAL parsing."""
import json
import tempfile
import unittest
from pathlib import Path

from rule1_ingest.essentials import ESSENTIALS_NS, parse_essentials_catalog, parse_essentials_snapshot


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
        snapshot = parse_essentials_snapshot(path)
        self.assertEqual(parsed["metadata"]["version"], "2026.10.15")
        self.assertEqual(len(parsed["actions"]), 58)
        self.assertEqual(len(parsed["principles"]), 28)
        self.assertEqual(len(snapshot["controls"]), 58)
        self.assertEqual(len(snapshot["groups"]), 33)
        self.assertTrue(all(item["metadata"]["oscal"] for item in snapshot["controls"].values()))
