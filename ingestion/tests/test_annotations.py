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
    CONTROL_REVIEW_GUIDANCE,
    MODEL,
    PROMPT_VERSION,
    TARGETED_REVIEW_RULES,
    _batch_prompt,
    LEGACY_MANIFEST_SHA256,
    call_openrouter,
    description_sha256,
    extract_annotation_arguments,
    input_sha256,
    generate_batch,
    load_cache,
    load_current_controls,
    parse_batch_response,
    prepare_generation,
    write_cache,
)

ROOT = Path(__file__).resolve().parents[2]
TARGETED_REVIEW_IDS = {
    "ism-0043", "ism-1731", "ism-2008", "ism-2126", "ism-2104", "ism-2117",
    "ism-2119", "ism-2130", "ism-1223", "ism-2097", "ism-2125", "ism-2147",
    "ism-2151", "ism-1558", "ism-1322", "ism-0409", "ism-0411", "ism-0041",
    "ism-0350", "ism-1163", "ism-1526", "ism-1563", "ism-1564", "ism-1565",
    "ism-1635", "ism-1803", "ism-1636", "ism-1594", "ism-1967", "ism-1971",
    "ism-2113", "ism-2135", "ism-0252", "ism-0408",
}


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

    def test_targeted_review_guidance_is_in_prompt_and_input_hash(self) -> None:
        self.assertEqual(set(CONTROL_REVIEW_GUIDANCE), TARGETED_REVIEW_IDS)
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "rule1.sqlite3"
            build_database(ROOT, database)
            controls = {item["control_id"]: item for item in load_current_controls(database)}
        targeted = controls["ism-0043"]
        self.assertIn(TARGETED_REVIEW_RULES, targeted["review_guidance"])
        self.assertIn("all eight incident response plan elements", targeted["review_guidance"])
        self.assertIn("2–3 complete sentences", targeted["review_guidance"])
        without_guidance = {key: value for key, value in targeted.items() if key != "review_guidance"}
        self.assertNotEqual(input_sha256(targeted), input_sha256(without_guidance))
        changed_guidance = {**targeted, "review_guidance": targeted["review_guidance"] + " Updated."}
        self.assertNotEqual(input_sha256(targeted), input_sha256(changed_guidance))
        prompt = _batch_prompt([targeted])
        self.assertIn("review_guidance", prompt)
        self.assertIn(TARGETED_REVIEW_RULES, prompt)
        self.assertIn("mandatory quality constraint", prompt)

        unrelated = controls["ism-0009"]
        self.assertNotIn("review_guidance", unrelated)
        cache = {
            row["control_id"]: row
            for row in load_cache(ROOT / "annotations/ism.json")["annotations"]
        }
        self.assertEqual(input_sha256(unrelated), cache["ism-0009"]["input_sha256"])

    def test_reviewed_targeted_controls_are_current_in_final_cache(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "rule1.sqlite3"
            build_database(ROOT, database)
            controls = load_current_controls(database)
        payload = load_cache(ROOT / "annotations/ism.json")
        _, stale, adopted = prepare_generation(controls, payload)
        self.assertEqual(stale, [])
        self.assertEqual(adopted, 0)

    def test_oscal_reconciliation_preserves_reviewed_description_corpus(self) -> None:
        payload = load_cache(ROOT / "annotations/ism.json")
        corpus = [
            (row["control_id"], row["ai_view"], row["ai_view_snarky"])
            for row in payload["annotations"]
        ]
        self.assertEqual(
            hashlib.sha256(
                json.dumps(corpus, ensure_ascii=False, separators=(",", ":")).encode()
            ).hexdigest(),
            "f627d9b46d4a050ddef54a4dcd50dd8708669f680651c6b716236121df296cd8",
        )
        current = [
            row for row in payload["annotations"]
            if row["catalog_version"] == "ISM-OSCAL-2026.09.4"
        ]
        self.assertEqual(len(current), 1_143)

    def test_generation_plan_uses_direct_oscal_delta_from_legacy_text(self) -> None:
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
        self.assertEqual(adopted, 861)
        self.assertEqual(len(stale), 282)
        self.assertEqual(
            sum(item["current_change_type"] == "modified" and ("ism", item["control_id"]) in stored for item in stale),
            202,
        )
        self.assertEqual(sum(("ism", item["control_id"]) not in stored for item in stale), 73)
        self.assertLessEqual((len(stale) + 24) // 25, 12)
        for control_id, expected in before.items():
            row = stored[("ism", control_id)]
            self.assertEqual((row["ai_view"], row["ai_view_snarky"], row["model"]), expected)


class AnnotationResponseTests(unittest.TestCase):
    def test_strict_response_accepts_two_and_three_sentences_in_request_order(self) -> None:
        raw = json.dumps({"annotations": [
            {
                "control_id": "ism-2",
                "ai_view": "First factual sentence. Second factual sentence.",
                "ai_view_snarky": "First Professional sentence. Second Professional sentence.",
            },
            {
                "control_id": "ism-1",
                "ai_view": "First factual sentence. Second factual sentence. Third factual sentence.",
                "ai_view_snarky": (
                    "First Professional sentence. Second Professional sentence. "
                    "Third Professional sentence."
                ),
            },
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
        self.assertEqual(
            request_payload["tool_choice"],
            {"type": "function", "function": {"name": "submit_annotations"}},
        )
        tool = request_payload["tools"][0]
        self.assertEqual(tool["function"]["name"], "submit_annotations")
        parameters = tool["function"]["parameters"]
        self.assertEqual(parameters["required"], ["annotations"])
        self.assertIs(parameters["additionalProperties"], False)
        row_schema = parameters["properties"]["annotations"]["items"]
        self.assertEqual(row_schema["required"], ["control_id", "ai_view", "ai_view_snarky"])
        self.assertIs(row_schema["additionalProperties"], False)

    def test_openrouter_extracts_forced_annotation_tool_arguments(self) -> None:
        arguments = json.dumps({"annotations": [
            {"control_id": "ism-1", "ai_view": "Factual", "ai_view_snarky": "Professional"}
        ]})
        response = unittest.mock.MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({
            "choices": [{"message": {
                "content": None,
                "tool_calls": [{
                    "type": "function",
                    "function": {"name": "submit_annotations", "arguments": arguments},
                }],
            }}]
        }).encode()
        with patch("urllib.request.urlopen", return_value=response):
            self.assertEqual(call_openrouter("prompt", "secret-value", attempts=1), arguments)

    def test_annotation_argument_extraction_rejects_malformed_or_missing_tool_calls(self) -> None:
        invalid = [
            None,
            {},
            {"content": ""},
            {"tool_calls": []},
            {"tool_calls": [{"function": {"name": "wrong", "arguments": "{}"}}]},
            {"tool_calls": [{"function": {"name": "submit_annotations", "arguments": ""}}]},
            {"tool_calls": [
                {"function": {"name": "submit_annotations", "arguments": "{}"}},
                {"function": {"name": "submit_annotations", "arguments": "{}"}},
            ]},
        ]
        for message in invalid:
            with self.subTest(message=message), self.assertRaises(ValueError):
                extract_annotation_arguments(message)
        self.assertEqual(extract_annotation_arguments({"content": '{"annotations":[]}'}), '{"annotations":[]}')

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

    def test_one_sentence_batch_is_retried(self) -> None:
        items = [{"control_id": "ism-1"}]
        one_sentence = json.dumps({"annotations": [
            {
                "control_id": "ism-1",
                "ai_view": "Only one factual sentence.",
                "ai_view_snarky": "Only one Professional sentence.",
            }
        ]})
        valid = json.dumps({"annotations": [
            {
                "control_id": "ism-1",
                "ai_view": "First factual sentence. Second factual sentence.",
                "ai_view_snarky": "First Professional sentence. Second Professional sentence.",
            }
        ]})
        with patch("rule1_ingest.annotations.call_openrouter", side_effect=[one_sentence, valid]) as request, patch("time.sleep"):
            result = generate_batch(items, "secret-value", attempts=2)
        self.assertEqual(result[0]["ai_view"], "First factual sentence. Second factual sentence.")
        self.assertEqual(request.call_count, 2)


if __name__ == "__main__":
    unittest.main()
