"""Focused regression tests for lossless Essentials OSCAL parsing."""
import json

import pytest

from rule1_ingest.essentials import ESSENTIALS_NS, parse_essentials_catalog


def test_preserves_domains_indicators_and_unknown_extensions(tmp_path):
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
    assert result["principles"][0]["id"] == "P-1"
    action = result["actions"][0]
    assert action["principle"] == "P-1"
    assert action["domains"] == ["identity-services"]
    assert action["parts"][0]["parts"][0] == indicator
    assert action["props"][1]["value"] == "retain-me"
    assert result["catalog"] == catalog


def test_rejects_missing_actions(tmp_path):
    path = tmp_path / "empty.json"
    path.write_text(json.dumps({"catalog": {"metadata": {"title": "Empty"}}}))
    with pytest.raises(ValueError, match="no actions"):
        parse_essentials_catalog(path)


def test_rejects_duplicate_action_ids(tmp_path):
    path = tmp_path / "duplicate.json"
    path.write_text(json.dumps({"catalog": {
        "metadata": {"title": "Duplicate"},
        "controls": [{"id": "A"}, {"id": "A"}],
    }}))
    with pytest.raises(ValueError, match="duplicate"):
        parse_essentials_catalog(path)

def test_official_catalog_snapshot(root_dir=None):
    """The committed ASD release is the acceptance fixture, not synthetic data."""
    from pathlib import Path
    from rule1_ingest.essentials import parse_essentials_snapshot

    root = Path(__file__).resolve().parents[2]
    path = root / "data/essentials/E4EIT_catalog-2026.10.15.json"
    parsed = parse_essentials_catalog(path)
    snapshot = parse_essentials_snapshot(path)
    assert parsed["metadata"]["version"] == "2026.10.15"
    assert len(parsed["actions"]) == 58
    assert len(parsed["principles"]) == 28
    assert len(snapshot["controls"]) == 58
    assert len(snapshot["groups"]) >= 28
    assert all(item["metadata"]["oscal"] for item in snapshot["controls"].values())
