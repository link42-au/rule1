from __future__ import annotations

import hashlib
import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from rule1_ingest.build import build_database
from rule1_ingest.annotations import (
    MODEL,
    PROMPT_VERSION,
    LEGACY_MANIFEST_SHA256,
    call_openrouter,
    description_sha256,
    input_sha256,
    generate_batch,
    load_cache,
    load_current_controls,
    parse_batch_response,
    prepare_generation,
    write_cache,
)

ROOT = Path(__file__).resolve().parents[2]


class AnnotationCacheTests(unittest.TestCase):
    def test_required_legacy_rows_remain_byte_exact(self) -> None:
        manifest_path = ROOT / "annotations/legacy-preservation.json"
        self.assertEqual(
            hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
            "028b45261b4c4db599e6d6c9eae423e4864c4cb16aa9871a84c5378add8bd5b5",
        )
        self.assertEqual(LEGACY_MANIFEST_SHA256, "028b45261b4c4db599e6d6c9eae423e4864c4cb16aa9871a84c5378add8bd5b5")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["legacy_corpus_sha256"], "19cd479576336c00da4c9db769d386e16795b0da3164b5e1ea6bfd7bb6c75d10")
        self.assertEqual(manifest["row_count"], 1_073)
        self.assertEqual(manifest["preserve_count"], 939)
        self.assertEqual(manifest["refresh_count"], 134)
        cache = {
            row["control_id"]: row for row in load_cache(ROOT / "annotations/ism.json")["annotations"]
        }
        preserved = [row for row in manifest["rows"] if row["disposition"] == "preserve"]
        for record in preserved:
            self.assertIn(record["control_id"], cache)
            self.assertEqual(description_sha256(cache[record["control_id"]]), record["description_sha256"])

    def test_cache_serialization_is_canonical_and_sorted(self) -> None:
        source = load_cache(ROOT / "annotations/ism.json")
        source["annotations"] = list(reversed(source["annotations"][:2]))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cache.json"
            write_cache(path, source)
            first = path.read_bytes()
            write_cache(path, load_cache(path))
            self.assertEqual(path.read_bytes(), first)
            ids = [row["control_id"] for row in load_cache(path)["annotations"]]
            self.assertEqual(ids, sorted(ids))

    def test_input_hash_covers_prompt_input_model_and_version(self) -> None:
        item = {
            "control_id": "ism-0043", "display_id": "ISM-0043", "label": "", "section": "Incidents",
            "guideline": "Planning", "applicability": "PROTECTED", "e8_levels": "N/A",
            "statement": "Have a plan.", "changes": [], "catalog_version": "v1",
        }
        original = input_sha256(item)
        self.assertEqual(original, input_sha256(dict(item)))
        self.assertNotEqual(original, input_sha256({**item, "statement": "Test the plan."}))
        self.assertEqual(MODEL, "nvidia/nemotron-3-ultra-550b-a55b:free")
        self.assertEqual(PROMPT_VERSION, "legacy-rule1-v1")

    def test_generation_plan_adopts_unchanged_legacy_text_and_only_generates_delta(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "rule1.sqlite3"
            build_database(ROOT, database)
            controls = load_current_controls(database)
        manifest = json.loads((ROOT / "annotations/legacy-preservation.json").read_text(encoding="utf-8"))
        payload = {"annotations": [
            {
                "framework": "ism", "control_id": row["control_id"], "catalog_version": "2025.12.9",
                "input_sha256": None, "ai_view": "legacy factual", "ai_view_snarky": "legacy Professional",
                "model": "legacy-provider-unrecorded",
            }
            for row in manifest["rows"]
        ]}
        before = {
            row["control_id"]: (row["ai_view"], row["ai_view_snarky"], row["model"])
            for row in payload["annotations"]
        }
        stored, stale, adopted = prepare_generation(controls, payload)
        self.assertEqual(adopted, 936)
        self.assertEqual(len(stale), 207)
        self.assertEqual(
            sum(item["current_change_type"] == "modified" and ("ism", item["control_id"]) in stored for item in stale),
            134,
        )
        self.assertEqual(sum(("ism", item["control_id"]) not in stored for item in stale), 73)
        self.assertLessEqual((len(stale) + 24) // 25, 9)
        for control_id, expected in before.items():
            row = stored[("ism", control_id)]
            self.assertEqual((row["ai_view"], row["ai_view_snarky"], row["model"]), expected)


class AnnotationResponseTests(unittest.TestCase):
    def test_strict_response_accepts_every_requested_id_in_request_order(self) -> None:
        raw = json.dumps({"annotations": [
            {"control_id": "ism-2", "ai_view": "F2", "ai_view_snarky": "P2"},
            {"control_id": "ism-1", "ai_view": "F1", "ai_view_snarky": "P1"},
        ]})
        parsed = parse_batch_response(raw, ["ism-1", "ism-2"])
        self.assertEqual([row["control_id"] for row in parsed], ["ism-1", "ism-2"])

    def test_strict_response_rejects_malformed_missing_extra_and_duplicate_rows(self) -> None:
        invalid = [
            "```json\n{}\n```",
            "[]",
            json.dumps({"annotations": []}),
            json.dumps({"annotations": [
                {"control_id": "ism-1", "ai_view": "F", "ai_view_snarky": "P"},
                {"control_id": "ism-1", "ai_view": "F", "ai_view_snarky": "P"},
            ]}),
            json.dumps({"annotations": [{"control_id": "ism-2", "ai_view": "F", "ai_view_snarky": "P"}]}),
            json.dumps({"annotations": [{"control_id": 1, "ai_view": "F", "ai_view_snarky": "P"}]}),
            json.dumps({"annotations": [{"control_id": "ism-1", "ai_view": "", "ai_view_snarky": "P"}]}),
        ]
        for raw in invalid:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                parse_batch_response(raw, ["ism-1"])

    def test_transient_openrouter_error_retries_without_exposing_key(self) -> None:
        response = unittest.mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({
            "choices": [{"message": {"content": "result"}}]
        }).encode()
        error = urllib.error.HTTPError("https://openrouter.ai", 429, "rate limited", {"Retry-After": "0"}, None)
        with patch("urllib.request.urlopen", side_effect=[error, response]) as request, patch("time.sleep"):
            self.assertEqual(call_openrouter("prompt", "secret-value", attempts=2), "result")
        self.assertEqual(request.call_count, 2)
        self.assertNotIn("secret-value", str(error))
        request_payload = json.loads(request.call_args.args[0].data)
        self.assertEqual(request_payload["provider"], {"data_collection": "allow"})

    def test_openrouter_http_error_surfaces_only_a_bounded_redacted_body(self) -> None:
        exposed_key = "sk-or-v1-example-secret-value"
        request_key = "request-secret"
        body = json.dumps({
            "error": {"message": f"No endpoints found matching your data policy {exposed_key} {request_key} " + ("x" * 2_000)}
        }).encode()
        error = urllib.error.HTTPError("https://openrouter.ai", 404, "not found", {}, io.BytesIO(body))
        with patch("urllib.request.urlopen", side_effect=error), self.assertRaises(RuntimeError) as raised:
            call_openrouter("public prompt", request_key, attempts=1)
        message = str(raised.exception)
        self.assertIn("OpenRouter HTTP 404", message)
        self.assertIn("No endpoints found matching your data policy", message)
        self.assertIn("[redacted]", message)
        self.assertNotIn(exposed_key, message)
        self.assertNotIn(request_key, message)
        self.assertLessEqual(len(message), 533)

    def test_semantically_invalid_batch_is_retried(self) -> None:
        items = [{"control_id": "ism-1"}]
        valid = json.dumps({"annotations": [
            {"control_id": "ism-1", "ai_view": "Factual", "ai_view_snarky": "Professional"}
        ]})
        with patch("rule1_ingest.annotations.call_openrouter", side_effect=["not json", valid]) as request, patch("time.sleep"):
            result = generate_batch(items, "secret-value", attempts=2)
        self.assertEqual(result[0]["ai_view"], "Factual")
        self.assertEqual(request.call_count, 2)


if __name__ == "__main__":
    unittest.main()
