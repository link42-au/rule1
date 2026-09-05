from __future__ import annotations

import json
import http.client
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from rule1_ingest.mitigation_mappings import (
    ATTACK_VERSION,
    CANARY_ALLOWED_EDGES,
    CANARY_CONTROL_IDS,
    CANARY_REQUIRED_EDGES,
    ISM_VERSION,
    MODEL,
    PROMPT_VERSION,
    REASONING,
    SYSTEM_PROMPT,
    _response_rows,
    _tool_schema,
    batch_prompt,
    call_openrouter,
    candidate_id,
    empty_cache,
    generate,
    generate_batch,
    generate_shard,
    generate_with_bisection,
    input_sha256,
    load_assessments,
    load_inputs,
    merge_shards,
    shard_controls,
    verify_canary,
    write_cache,
)

ROOT = Path(__file__).resolve().parents[2]


def contexts() -> tuple[list[dict[str, object]], list[dict[str, str]]]:
    controls: list[dict[str, object]] = [{
        "control_id": "ism-0001",
        "display_id": "ISM-0001",
        "catalog_version": ISM_VERSION,
        "statement": "Administrators configure systems to record security events and review alerts promptly.",
        "section_hierarchy": [{
            "id": "logging", "title": "Event logging",
            "overview": "Security events are collected and analysed to identify suspicious activity.",
        }],
        "factual_annotation": "This control requires security event recording and prompt alert review.",
    }]
    mitigations = [{
        "mitigation_id": "M1047",
        "name": "Audit",
        "description": "Configure systems to collect and analyse audit logs for signs of malicious activity.",
        "attack_version": ATTACK_VERSION,
    }]
    return controls, mitigations


def valid_assessment() -> dict[str, object]:
    controls, mitigations = contexts()
    return {
        "control_id": "ism-0001",
        "disposition": "mapped",
        "unmapped_reason": None,
        "candidates": [{
            "candidate_id": candidate_id("ism-0001", "M1047"),
            "mitigation_id": "M1047",
            "relationship": "enables",
            "security_function": "detect",
            "confidence": "high",
            "rationale": (
                "Recording security events and reviewing alerts promptly provides the audit records and "
                "analysis needed to identify signs of malicious activity."
            ),
            "evidence": [{
                "kind": "ism-control",
                "control_id": "ism-0001",
                "catalog_version": ISM_VERSION,
                "statement": controls[0]["statement"],
                "section_hierarchy": controls[0]["section_hierarchy"],
                "factual_annotation": controls[0]["factual_annotation"],
                "matched_text": "record security events and review alerts promptly",
            }, {
                "kind": "attack-mitigation",
                "mitigation_id": "M1047",
                "attack_version": ATTACK_VERSION,
                "name": "Audit",
                "description": mitigations[0]["description"],
                "matched_text": "collect and analyse audit logs",
            }],
            "status": "candidate",
            "reviewed_by": None,
            "reviewed_at": None,
        }],
        "provenance": {
            "ism_catalog_version": ISM_VERSION,
            "attack_version": ATTACK_VERSION,
            "model": MODEL,
            "prompt_version": PROMPT_VERSION,
            "input_sha256": input_sha256(controls[0], mitigations),
            "generated_at": "2026-09-05T01:02:03Z",
        },
    }


def write_payload(path: Path, assessment: dict[str, object]) -> None:
    payload = empty_cache()
    payload["assessments"] = [assessment]
    write_cache(path, payload)


class MitigationInputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.controls, cls.mitigations = load_inputs(ROOT)

    def test_source_native_inputs_cover_exact_pinned_partition(self) -> None:
        self.assertEqual(len(self.controls), 1_143)
        self.assertEqual(len({row["control_id"] for row in self.controls}), 1_143)
        self.assertEqual(len(self.mitigations), 44)
        self.assertEqual(len({row["mitigation_id"] for row in self.mitigations}), 44)
        self.assertTrue(all(row["catalog_version"] == ISM_VERSION for row in self.controls))
        self.assertTrue(all(row["attack_version"] == ATTACK_VERSION for row in self.mitigations))
        self.assertTrue(all(row["section_hierarchy"] for row in self.controls))
        self.assertTrue(all(row["factual_annotation"] for row in self.controls))
        self.assertTrue(set(CANARY_CONTROL_IDS).issubset({row["control_id"] for row in self.controls}))
        self.assertTrue(
            {"M1022", "M1047", "M1053"}.issubset({row["mitigation_id"] for row in self.mitigations})
        )

    def test_eight_shards_are_deterministic_disjoint_and_complete(self) -> None:
        shards = [shard_controls(list(reversed(self.controls)), index) for index in range(8)]
        ids = [{row["control_id"] for row in shard} for shard in shards]
        self.assertEqual([len(shard) for shard in shards], [143] * 7 + [142])
        self.assertEqual(set().union(*ids), {row["control_id"] for row in self.controls})
        self.assertTrue(all(ids[left].isdisjoint(ids[right]) for left in range(8) for right in range(left)))
        self.assertEqual(shards, [shard_controls(self.controls, index) for index in range(8)])

    def test_input_hash_covers_full_context_prompt_model_and_all_mitigations(self) -> None:
        control = self.controls[0]
        original = input_sha256(control, self.mitigations)
        changed_control = {**control, "statement": f"{control['statement']} Changed."}
        self.assertNotEqual(original, input_sha256(changed_control, self.mitigations))
        changed_hierarchy = {**control, "section_hierarchy": [
            {**control["section_hierarchy"][0], "overview": "Changed overview."},
            *control["section_hierarchy"][1:],
        ]}
        self.assertNotEqual(original, input_sha256(changed_hierarchy, self.mitigations))
        changed_annotation = {**control, "factual_annotation": "Changed factual annotation."}
        self.assertNotEqual(original, input_sha256(changed_annotation, self.mitigations))
        changed_mitigations = [dict(row) for row in self.mitigations]
        changed_mitigations[-1]["description"] += " Changed."
        self.assertNotEqual(original, input_sha256(control, changed_mitigations))
        prompt = batch_prompt([control], self.mitigations)
        self.assertNotRegex(prompt, r"\bT\d{4}(?:\.\d{3})?\b")
        self.assertIn("Default to unmapped", prompt)
        self.assertIn("directly establishes", prompt)
        self.assertIn("specifically named security process or capability", prompt)
        self.assertIn("implemented and maintained", prompt)
        self.assertIn("documentation, planning, or governance alone", prompt)
        for insufficient_basis in (
            "Governance", "documentation", "incident context", "possible future action",
            "shared security goal", "section-topic proximity", "inferred downstream activity",
        ):
            self.assertIn(insufficient_basis, prompt)
        self.assertIn("must not override or broaden", prompt)
        self.assertIn("Do not invent facts", prompt)
        self.assertIn("control_basis", prompt)
        self.assertIn("mitigation_basis", prompt)

    def test_v3_provider_contract_is_pinned(self) -> None:
        self.assertEqual(PROMPT_VERSION, "ism-attack-mitigation-v3")
        self.assertEqual(MODEL, "minimax/minimax-m3:free")
        self.assertEqual(REASONING, {"effort": "medium", "exclude": True})
        self.assertIn("section-topic proximity", SYSTEM_PROMPT)


class MitigationCacheTests(unittest.TestCase):
    def validate(self, assessment: dict[str, object]) -> dict[str, object]:
        controls, mitigations = contexts()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cache.json"
            write_payload(path, assessment)
            return load_assessments(path, controls, mitigations, require_complete=False)

    def test_valid_mapping_has_stable_candidate_provenance_and_exact_snapshots(self) -> None:
        payload = self.validate(valid_assessment())
        candidate = payload["assessments"][0]["candidates"][0]
        self.assertEqual(candidate["candidate_id"], candidate_id("ism-0001", "M1047"))
        self.assertEqual(candidate["relationship"], "enables")
        self.assertEqual(candidate["status"], "candidate")
        self.assertEqual(candidate["evidence"][0]["matched_text"], "record security events and review alerts promptly")

    def test_unmapped_requires_specific_reason_and_zero_candidates(self) -> None:
        assessment = valid_assessment()
        assessment["disposition"] = "unmapped"
        assessment["candidates"] = []
        assessment["unmapped_reason"] = (
            "The requirement to record security events is an operational direction, but it does not "
            "defensibly enable any mitigation in the supplied catalogue."
        )
        self.validate(assessment)
        assessment["unmapped_reason"] = "No relevant mitigation."
        with self.assertRaisesRegex(ValueError, "incomplete"):
            self.validate(assessment)

    def test_rejects_unknown_duplicate_and_stale_mitigation_candidates(self) -> None:
        unknown = valid_assessment()
        unknown["candidates"][0]["mitigation_id"] = "M9999"
        with self.assertRaisesRegex(ValueError, "unknown ATT&CK mitigation"):
            self.validate(unknown)
        duplicate = valid_assessment()
        duplicate["candidates"].append(dict(duplicate["candidates"][0]))
        with self.assertRaises(ValueError):
            self.validate(duplicate)
        stale = valid_assessment()
        stale["candidates"][0]["evidence"][0]["statement"] = "Invented statement."
        with self.assertRaisesRegex(ValueError, "snapshot is stale"):
            self.validate(stale)

    def test_rejects_invented_excerpts_generic_rationale_and_technique_data(self) -> None:
        invented = valid_assessment()
        invented["candidates"][0]["evidence"][1]["matched_text"] = "invented evidence"
        with self.assertRaisesRegex(ValueError, "matched evidence is not exact"):
            self.validate(invented)
        generic = valid_assessment()
        generic["candidates"][0]["rationale"] = "This control enables this mitigation."
        with self.assertRaisesRegex(ValueError, "incomplete|generic"):
            self.validate(generic)
        technique_id = valid_assessment()
        technique_id["candidates"][0]["rationale"] += " It applies to T1059."
        with self.assertRaisesRegex(ValueError, "forbidden ATT&CK technique ID"):
            self.validate(technique_id)
        technique_key = valid_assessment()
        technique_key["technique_id"] = "none"
        with self.assertRaisesRegex(ValueError, "forbidden technique key"):
            self.validate(technique_key)

    def test_rejects_rationale_that_names_a_different_mitigation(self) -> None:
        assessment = valid_assessment()
        assessment["candidates"][0]["rationale"] = (
            "Recording security events and reviewing alerts provides the audit analysis described by M1047, "
            "but this candidate incorrectly claims that M1053 is the mitigation being enabled."
        )
        with self.assertRaisesRegex(ValueError, "mentions a different mitigation: M1053"):
            self.validate(assessment)

    def test_rejects_missing_duplicate_and_stale_controls_and_incomplete_partition(self) -> None:
        controls, mitigations = contexts()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cache.json"
            write_payload(path, valid_assessment())
            with self.assertRaisesRegex(ValueError, "expected 1143 assessed controls"):
                load_assessments(path, controls, mitigations, require_complete=True)
            payload = empty_cache()
            payload["assessments"] = [valid_assessment(), valid_assessment()]
            write_cache(path, payload)
            with self.assertRaisesRegex(ValueError, "duplicate control assessment"):
                load_assessments(path, controls, mitigations, require_complete=False)
            stale = valid_assessment()
            stale["control_id"] = "ism-9999"
            write_payload(path, stale)
            with self.assertRaisesRegex(ValueError, "stale or unknown"):
                load_assessments(path, controls, mitigations, require_complete=False)

    def test_rejects_noncanonical_or_invalid_generation_time(self) -> None:
        for generated_at in ("2026-09-05T01:02:03+00:00", "2026-09-05T01:02:03.1Z", "2026-02-30T01:02:03Z"):
            assessment = valid_assessment()
            assessment["provenance"]["generated_at"] = generated_at
            with self.subTest(generated_at=generated_at), self.assertRaisesRegex(ValueError, "generated_at"):
                self.validate(assessment)

    def test_cache_serialization_is_atomic_canonical_and_sorted(self) -> None:
        first = valid_assessment()
        second = json.loads(json.dumps(first))
        second["control_id"] = "ism-0000"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cache.json"
            payload = empty_cache()
            payload["assessments"] = [first, second]
            write_cache(path, payload)
            initial = path.read_bytes()
            write_cache(path, json.loads(path.read_text()))
            self.assertEqual(path.read_bytes(), initial)
            self.assertEqual([row["control_id"] for row in json.loads(initial)["assessments"]], ["ism-0000", "ism-0001"])


class MitigationGenerationTests(unittest.TestCase):
    def test_openrouter_request_uses_v3_model_and_private_medium_reasoning(self) -> None:
        captured: dict[str, object] = {}

        class Response:
            def __enter__(self) -> "Response":
                return self

            def __exit__(self, *_: object) -> None:
                return None

            @staticmethod
            def read() -> bytes:
                arguments = json.dumps({"assessments": []})
                return json.dumps({
                    "choices": [{"message": {"tool_calls": [{
                        "function": {"name": "submit_mitigation_assessments", "arguments": arguments}
                    }]}}]
                }).encode()

        def open_request(request: object, **_: object) -> Response:
            captured.update(json.loads(request.data))
            return Response()

        with patch("urllib.request.urlopen", side_effect=open_request):
            call_openrouter("prompt", "secret", ["M1047"], ["ism-0109"], attempts=1)
        self.assertEqual(captured["model"], "minimax/minimax-m3:free")
        self.assertEqual(captured["reasoning"], {"effort": "medium", "exclude": True})

    def test_openrouter_retries_only_transient_incomplete_responses(self) -> None:
        class Response:
            def __enter__(self) -> "Response":
                return self

            def __exit__(self, *_: object) -> None:
                return None

            @staticmethod
            def read() -> bytes:
                arguments = json.dumps({"assessments": []})
                return json.dumps({"choices": [{"message": {"tool_calls": [{
                    "function": {"name": "submit_mitigation_assessments", "arguments": arguments}
                }]}}]}).encode()

        transient_errors = (
            http.client.IncompleteRead(b"partial", 12),
            http.client.RemoteDisconnected("connection closed"),
        )
        for error in transient_errors:
            with self.subTest(error=type(error).__name__), patch(
                "urllib.request.urlopen", side_effect=[error, Response()]
            ) as request, patch("time.sleep") as sleep:
                self.assertEqual(
                    call_openrouter("prompt", "secret", ["M1047"], ["ism-0109"], attempts=2),
                    '{"assessments": []}',
                )
                self.assertEqual(request.call_count, 2)
                sleep.assert_called_once_with(2)
            with self.subTest(final_error=type(error).__name__), patch(
                "urllib.request.urlopen", side_effect=error
            ), patch("time.sleep"):
                with self.assertRaises(type(error)):
                    call_openrouter("prompt", "secret", ["M1047"], ["ism-0109"], attempts=1)

    def test_tool_schema_pins_requested_control_ids_and_count(self) -> None:
        schema = _tool_schema(["M1047"], ["ism-0161", "ism-0164"])
        assessments = schema["function"]["parameters"]["properties"]["assessments"]
        self.assertEqual(assessments["minItems"], 2)
        self.assertEqual(assessments["maxItems"], 2)
        self.assertEqual(assessments["items"]["properties"]["control_id"]["enum"], ["ism-0161", "ism-0164"])
        candidate = assessments["items"]["properties"]["candidates"]["items"]
        self.assertEqual(
            set(candidate["properties"]),
            {
                "mitigation_id", "security_function", "confidence", "rationale",
                "control_basis", "mitigation_basis",
            },
        )
        self.assertEqual(candidate["properties"]["control_basis"]["minLength"], 8)
        self.assertEqual(candidate["properties"]["control_basis"]["maxLength"], 320)
        self.assertEqual(candidate["properties"]["mitigation_basis"]["minLength"], 8)
        self.assertEqual(candidate["properties"]["mitigation_basis"]["maxLength"], 320)

    @staticmethod
    def _unmapped_row(control: dict[str, object], mitigations: list[dict[str, str]]) -> dict[str, object]:
        return {
            "control_id": control["control_id"],
            "disposition": "unmapped",
            "unmapped_reason": (
                "The requirement to record security events is explicit, but it does not itself "
                "defensibly enable any mitigation in the supplied catalogue."
            ),
            "candidates": [],
            "provenance": {
                "ism_catalog_version": ISM_VERSION,
                "attack_version": ATTACK_VERSION,
                "model": MODEL,
                "prompt_version": PROMPT_VERSION,
                "input_sha256": input_sha256(control, mitigations),
                "generated_at": "2026-09-05T01:02:03Z",
            },
        }

    def test_response_expands_only_control_to_mitigation_candidates(self) -> None:
        controls, mitigations = contexts()
        raw = json.dumps({"assessments": [{
            "control_id": "ism-0001", "disposition": "mapped", "unmapped_reason": None,
            "candidates": [{
                "mitigation_id": "M1047", "security_function": "detect", "confidence": "high",
                "rationale": (
                    "Recording security events and reviewing alerts promptly provides the audit records and "
                    "analysis needed to identify signs of malicious activity."
                ),
                "control_basis": "record security events and review alerts promptly",
                "mitigation_basis": "collect and analyse audit logs",
            }],
        }]})
        rows = _response_rows(raw, controls, mitigations, "2026-09-05T01:02:03Z")
        candidate = rows[0]["candidates"][0]
        self.assertEqual(candidate["relationship"], "enables")
        self.assertEqual(candidate["status"], "candidate")
        self.assertEqual(candidate["evidence"][0]["matched_text"], "record security events and review alerts promptly")
        self.assertEqual(candidate["evidence"][1]["matched_text"], "collect and analyse audit logs")
        self.assertNotIn("technique_id", json.dumps(rows))

    def test_response_discards_harmless_extras_but_keeps_required_shape_strict(self) -> None:
        controls, mitigations = contexts()
        candidate = {
            "mitigation_id": "M1047", "security_function": "detect", "confidence": "high",
            "rationale": (
                "Recording security events and reviewing alerts promptly provides the audit records and "
                "analysis needed to identify signs of malicious activity."
            ),
            "control_basis": "record security events and review alerts promptly",
            "mitigation_basis": "collect and analyse audit logs",
            "harmless_note": "Provider-added explanation",
        }
        assessment = {
            "control_id": "ism-0001", "disposition": "mapped", "unmapped_reason": None,
            "candidates": [candidate], "provider_metadata": {"sequence": 1},
        }
        rows = _response_rows(
            json.dumps({"assessments": [assessment]}), controls, mitigations, "2026-09-05T01:02:03Z"
        )
        self.assertNotIn("harmless_note", json.dumps(rows))
        self.assertNotIn("provider_metadata", json.dumps(rows))

        for missing, target in (("rationale", candidate), ("disposition", assessment)):
            with self.subTest(missing=missing):
                invalid_assessment = dict(assessment)
                invalid_candidate = dict(candidate)
                if target is candidate:
                    invalid_candidate.pop(missing)
                else:
                    invalid_assessment.pop(missing)
                invalid_assessment["candidates"] = [invalid_candidate]
                with self.assertRaisesRegex(ValueError, "unexpected shape"):
                    _response_rows(
                        json.dumps({"assessments": [invalid_assessment]}), controls, mitigations,
                        "2026-09-05T01:02:03Z",
                    )

    def test_response_rejects_technique_bearing_extras_before_discard(self) -> None:
        controls, mitigations = contexts()
        base = {
            "control_id": "ism-0001", "disposition": "unmapped", "unmapped_reason": (
                "The requirement to record security events does not itself defensibly enable any "
                "mitigation in the supplied catalogue."
            ), "candidates": [],
        }
        for extra in ({"technique_note": "none"}, {"provider_note": "Related to T1059"}):
            with self.subTest(extra=extra), self.assertRaisesRegex(ValueError, "technique"):
                _response_rows(
                    json.dumps({"assessments": [{**base, **extra}]}), controls, mitigations,
                    "2026-09-05T01:02:03Z",
                )

    def test_response_normalises_trailing_whitespace_in_canonical_matched_text(self) -> None:
        controls, mitigations = contexts()
        mitigations[0]["description"] += "\n\n"
        raw = json.dumps({"assessments": [{
            "control_id": "ism-0001", "disposition": "mapped", "unmapped_reason": None,
            "candidates": [{
                "mitigation_id": "M1047", "security_function": "detect", "confidence": "high",
                "rationale": (
                    "Recording security events and reviewing alerts promptly provides the audit records and "
                    "analysis needed to identify signs of malicious activity."
                ),
                "control_basis": "record   security events\nand review alerts promptly",
                "mitigation_basis": "collect  and analyse\naudit logs",
            }],
        }]})
        candidate = _response_rows(raw, controls, mitigations, "2026-09-05T01:02:03Z")[0]["candidates"][0]
        self.assertEqual(candidate["evidence"][1]["description"], mitigations[0]["description"])
        self.assertEqual(candidate["evidence"][0]["matched_text"], "record security events and review alerts promptly")
        self.assertEqual(candidate["evidence"][1]["matched_text"], "collect and analyse audit logs")

    def test_paraphrased_basis_resolves_to_canonical_source_and_rejects_ungrounded_text(self) -> None:
        controls, mitigations = contexts()

        def response(control_basis: str, mitigation_basis: str) -> str:
            return json.dumps({"assessments": [{
                "control_id": "ism-0001", "disposition": "mapped", "unmapped_reason": None,
                "candidates": [{
                    "mitigation_id": "M1047", "security_function": "detect", "confidence": "high",
                    "rationale": (
                        "Recording security events and reviewing alerts promptly provides the audit records and "
                        "analysis needed to identify signs of malicious activity."
                    ),
                    "control_basis": control_basis,
                    "mitigation_basis": mitigation_basis,
                }],
            }]})

        generated = _response_rows(
            response(
                "Systems record important security events, with alerts reviewed promptly.",
                "Audit logs are analysed to find malicious activity.",
            ),
            controls, mitigations, "2026-09-05T01:02:03Z",
        )
        self.assertEqual(
            generated[0]["candidates"][0]["evidence"][0]["matched_text"],
            controls[0]["statement"],
        )
        self.assertEqual(
            generated[0]["candidates"][0]["evidence"][1]["matched_text"],
            mitigations[0]["description"],
        )
        with self.assertRaisesRegex(ValueError, "control_basis is not grounded"):
            _response_rows(
                response(
                    "Invented downstream implementation mechanism.",
                    "Audit logs are analysed to find malicious activity.",
                ),
                controls, mitigations, "2026-09-05T01:02:03Z",
            )
        with self.assertRaisesRegex(ValueError, "mitigation_basis is not grounded"):
            _response_rows(
                response(
                    "Systems record important security events, with alerts reviewed promptly.",
                    "Invented downstream mechanism.",
                ),
                controls, mitigations, "2026-09-05T01:02:03Z",
            )

    def test_invalid_successful_response_is_retried(self) -> None:
        controls, mitigations = contexts()
        invalid = json.dumps({"assessments": []})
        valid = json.dumps({"assessments": [{
            "control_id": "ism-0001", "disposition": "unmapped", "candidates": [],
            "unmapped_reason": (
                "The requirement to record security events does not itself defensibly enable any "
                "mitigation in the supplied catalogue."
            ),
        }]})
        with patch("rule1_ingest.mitigation_mappings.call_openrouter", side_effect=[invalid, valid]) as request, patch("time.sleep"):
            rows = generate_batch(controls, mitigations, "secret", attempts=2)
        self.assertEqual(request.call_count, 2)
        self.assertEqual(rows[0]["disposition"], "unmapped")

    def test_generation_initialises_checkpoint_before_first_provider_failure(self) -> None:
        controls, mitigations = contexts()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cache.json"
            with patch("rule1_ingest.mitigation_mappings.load_inputs", return_value=(controls, mitigations)), patch(
                "rule1_ingest.mitigation_mappings.generate_batch", side_effect=RuntimeError("provider unavailable")
            ):
                with self.assertRaisesRegex(RuntimeError, "provider unavailable"):
                    generate(Path(directory), path, "secret", 1)
            self.assertTrue(path.exists())
            payload = json.loads(path.read_text())
            self.assertEqual(payload["assessments"], [])

    def test_generation_initialises_checkpoint_before_secret_or_input_validation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cache.json"
            with self.assertRaisesRegex(ValueError, "OPENROUTER_API_KEY"):
                generate(Path(directory), path, "", 1)
            self.assertTrue(path.exists())
            self.assertEqual(json.loads(path.read_text()), empty_cache())

    def test_generation_discards_the_stale_v2_model_cache(self) -> None:
        controls, mitigations = contexts()
        stale = empty_cache()
        stale["model"] = "nvidia/nemotron-3.5-lightning:free"
        stale["prompt_version"] = "ism-attack-mitigation-v2"
        stale["assessments"] = [{"old": "noisy mapping"}]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cache.json"
            path.write_text(json.dumps(stale), encoding="utf-8")
            with patch("rule1_ingest.mitigation_mappings.load_inputs", return_value=(controls, mitigations)), patch(
                "rule1_ingest.mitigation_mappings.generate_batch",
                return_value=[self._unmapped_row(controls[0], mitigations)],
            ):
                generated, stale_count = generate(Path(directory), path, "secret", 20)
            payload = json.loads(path.read_text())
            self.assertEqual((generated, stale_count), (1, 1))
            self.assertEqual(payload["model"], MODEL)
            self.assertEqual(payload["prompt_version"], PROMPT_VERSION)
            self.assertNotIn("old", json.dumps(payload))

    def test_exhausted_invalid_batch_bisects_stably_and_checkpoints_valid_rows(self) -> None:
        original_controls, mitigations = contexts()
        controls = [
            {**original_controls[0], "control_id": f"ism-{index:04d}", "display_id": f"ISM-{index:04d}"}
            for index in range(1, 5)
        ]
        calls: list[tuple[str, ...]] = []
        attempt_limits: list[int] = []

        def batch_result(
            batch: list[dict[str, object]], *_: object, attempts: int
        ) -> list[dict[str, object]]:
            ids = tuple(str(row["control_id"]) for row in batch)
            calls.append(ids)
            attempt_limits.append(attempts)
            if ids in {
                ("ism-0001", "ism-0002", "ism-0003", "ism-0004"),
                ("ism-0003", "ism-0004"),
                ("ism-0004",),
            }:
                raise ValueError("duplicate expected control ID")
            return [self._unmapped_row(row, mitigations) for row in batch]

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cache.json"
            with patch("rule1_ingest.mitigation_mappings.load_inputs", return_value=(controls, mitigations)), patch(
                "rule1_ingest.mitigation_mappings.generate_batch", side_effect=batch_result
            ):
                with self.assertRaisesRegex(ValueError, "duplicate expected control ID"):
                    generate(Path(directory), path, "secret", 4)
            self.assertEqual(calls, [
                ("ism-0001", "ism-0002", "ism-0003", "ism-0004"),
                ("ism-0001", "ism-0002"),
                ("ism-0003", "ism-0004"),
                ("ism-0003",),
                ("ism-0004",),
            ])
            self.assertEqual(attempt_limits, [1, 1, 1, 4, 4])
            persisted = load_assessments(path, controls, mitigations, require_complete=False)
            self.assertEqual(
                [row["control_id"] for row in persisted["assessments"]],
                ["ism-0001", "ism-0002", "ism-0003"],
            )

    def test_invalid_singleton_is_not_split_or_checkpointed(self) -> None:
        controls, mitigations = contexts()
        checkpoints: list[list[dict[str, object]]] = []
        with patch(
            "rule1_ingest.mitigation_mappings.generate_batch",
            side_effect=ValueError("invalid singleton"),
        ) as request:
            with self.assertRaisesRegex(ValueError, "invalid singleton"):
                generate_with_bisection(controls, mitigations, "secret", checkpoints.append)
        request.assert_called_once()
        self.assertEqual(checkpoints, [])

    def test_invalid_twenty_control_batch_bisects_to_ten(self) -> None:
        original_controls, mitigations = contexts()
        controls = [
            {**original_controls[0], "control_id": f"ism-{index:04d}", "display_id": f"ISM-{index:04d}"}
            for index in range(1, 21)
        ]
        sizes: list[int] = []
        checkpoints: list[int] = []

        def batch_result(batch: list[dict[str, object]], *_: object, attempts: int) -> list[dict[str, object]]:
            sizes.append(len(batch))
            self.assertEqual(attempts, 1)
            if len(batch) == 20:
                raise ValueError("invalid twenty-control batch")
            return [self._unmapped_row(row, mitigations) for row in batch]

        with patch("rule1_ingest.mitigation_mappings.generate_batch", side_effect=batch_result):
            generate_with_bisection(
                controls, mitigations, "secret", lambda rows: checkpoints.append(len(rows))
            )
        self.assertEqual(sizes, [20, 10, 10])
        self.assertEqual(checkpoints, [10, 10])

    def test_selected_generation_writes_only_the_explicit_canary_controls(self) -> None:
        original_controls, mitigations = contexts()
        controls = [
            {**original_controls[0], "control_id": control_id, "display_id": control_id.upper()}
            for control_id in ("ism-0001", "ism-0002")
        ]

        def rows(batch: list[dict[str, object]], *_: object, **__: object) -> list[dict[str, object]]:
            return [self._unmapped_row(row, mitigations) for row in batch]

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "canary.json"
            with patch("rule1_ingest.mitigation_mappings.load_inputs", return_value=(controls, mitigations)), patch(
                "rule1_ingest.mitigation_mappings.generate_batch", side_effect=rows
            ):
                generate(
                    Path(directory), path, "secret", 20,
                    selected_control_ids=("ism-0002",),
                )
            payload = load_assessments(path, controls, mitigations, require_complete=False)
            self.assertEqual(
                [row["control_id"] for row in payload["assessments"]],
                ["ism-0002"],
            )

    def test_generation_keeps_current_rows_and_regenerates_individually_stale_rows(self) -> None:
        original_controls, mitigations = contexts()
        controls = [
            {**original_controls[0], "control_id": f"ism-{index:04d}", "display_id": f"ISM-{index:04d}"}
            for index in (1, 2)
        ]
        current = self._unmapped_row(controls[0], mitigations)
        stale = self._unmapped_row(controls[1], mitigations)
        stale["provenance"]["input_sha256"] = "0" * 64
        requested: list[tuple[str, ...]] = []

        def rows(batch: list[dict[str, object]], *_: object, **__: object) -> list[dict[str, object]]:
            requested.append(tuple(str(row["control_id"]) for row in batch))
            return [self._unmapped_row(row, mitigations) for row in batch]

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cache.json"
            payload = empty_cache()
            payload["assessments"] = [current, stale]
            write_cache(path, payload)
            with patch("rule1_ingest.mitigation_mappings.load_inputs", return_value=(controls, mitigations)), patch(
                "rule1_ingest.mitigation_mappings.generate_batch", side_effect=rows
            ):
                self.assertEqual(generate(Path(directory), path, "secret", 20), (1, 1))
            self.assertEqual(requested, [("ism-0002",)])
            validated = load_assessments(path, controls, mitigations, require_complete=False)
            self.assertEqual(len(validated["assessments"]), 2)

    def test_shard_seeds_only_its_valid_tracked_rows_before_auth_failure(self) -> None:
        original_controls, mitigations = contexts()
        controls = [
            {**original_controls[0], "control_id": f"ism-{index:04d}", "display_id": f"ISM-{index:04d}"}
            for index in range(1, 17)
        ]
        tracked_payload = empty_cache()
        tracked_payload["assessments"] = [
            self._unmapped_row(controls[0], mitigations),
            self._unmapped_row(controls[1], mitigations),
        ]
        with tempfile.TemporaryDirectory() as directory:
            tracked = Path(directory) / "tracked.json"
            output = Path(directory) / "shard-0.json"
            write_cache(tracked, tracked_payload)
            with patch("rule1_ingest.mitigation_mappings.load_inputs", return_value=(controls, mitigations)):
                with self.assertRaisesRegex(ValueError, "OPENROUTER_API_KEY"):
                    generate_shard(Path(directory), tracked, output, "", 20, 0)
            seeded = load_assessments(output, controls, mitigations, require_complete=False)
            self.assertEqual(
                [row["control_id"] for row in seeded["assessments"]],
                ["ism-0001"],
            )


class MitigationShardMergeTests(unittest.TestCase):
    def setUp(self) -> None:
        original_controls, self.mitigations = contexts()
        self.controls = [
            {**original_controls[0], "control_id": f"ism-{index:04d}", "display_id": f"ISM-{index:04d}"}
            for index in range(1, 9)
        ]

    def row(self, control: dict[str, object]) -> dict[str, object]:
        return MitigationGenerationTests._unmapped_row(control, self.mitigations)

    def test_strict_merge_requires_all_shards_and_writes_canonical_cache(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            shard_dir = Path(directory) / "shards"
            output = Path(directory) / "combined.json"
            for index, control in enumerate(self.controls):
                write_payload(shard_dir / f"shard-{index}.json", self.row(control))
            with patch("rule1_ingest.mitigation_mappings.load_inputs", return_value=(self.controls, self.mitigations)), patch(
                "rule1_ingest.mitigation_mappings.EXPECTED_CONTROL_COUNT", 8
            ):
                merged = merge_shards(Path(directory), shard_dir, output, require_complete=True)
            self.assertEqual(len(merged["assessments"]), 8)
            self.assertEqual(json.loads(output.read_text()), merged)

    def test_strict_merge_rejects_missing_partition_wrong_membership_and_technique_fields(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            shard_dir = Path(directory) / "shards"
            output = Path(directory) / "combined.json"
            with patch("rule1_ingest.mitigation_mappings.load_inputs", return_value=(self.controls, self.mitigations)), patch(
                "rule1_ingest.mitigation_mappings.EXPECTED_CONTROL_COUNT", 8
            ):
                with self.assertRaisesRegex(ValueError, "required mitigation shard is missing"):
                    merge_shards(Path(directory), shard_dir, output, require_complete=True)
                write_payload(shard_dir / "shard-0.json", self.row(self.controls[1]))
                with self.assertRaisesRegex(ValueError, "wrong shard"):
                    merge_shards(Path(directory), shard_dir, output, require_complete=False)
                invalid = self.row(self.controls[0])
                invalid["technique_id"] = "T1059"
                write_payload(shard_dir / "shard-0.json", invalid)
                with self.assertRaisesRegex(ValueError, "technique"):
                    merge_shards(Path(directory), shard_dir, output, require_complete=False)

    def test_strict_merge_rejects_complete_file_set_with_partition_gap_and_stale_row(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            shard_dir = Path(directory) / "shards"
            output = Path(directory) / "combined.json"
            for index, control in enumerate(self.controls):
                payload = empty_cache()
                payload["assessments"] = [] if index == 7 else [self.row(control)]
                write_cache(shard_dir / f"shard-{index}.json", payload)
            with patch("rule1_ingest.mitigation_mappings.load_inputs", return_value=(self.controls, self.mitigations)), patch(
                "rule1_ingest.mitigation_mappings.EXPECTED_CONTROL_COUNT", 8
            ):
                with self.assertRaisesRegex(ValueError, "partition is incomplete"):
                    merge_shards(Path(directory), shard_dir, output, require_complete=True)
            stale = self.row(self.controls[0])
            stale["provenance"]["input_sha256"] = "0" * 64
            write_payload(shard_dir / "shard-0.json", stale)
            with patch("rule1_ingest.mitigation_mappings.load_inputs", return_value=(self.controls, self.mitigations)):
                with self.assertRaisesRegex(ValueError, "provenance input_sha256 is stale"):
                    merge_shards(Path(directory), shard_dir, output, require_complete=False)

    def test_strict_merge_rejects_cross_shard_duplicate_controls_and_candidates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            shard_dir = Path(directory) / "shards"
            output = Path(directory) / "combined.json"
            for index in (0, 1):
                write_cache(shard_dir / f"shard-{index}.json", empty_cache())
            duplicate_control = {"control_id": "ism-0001", "candidates": []}

            def duplicate_control_payload(path: Path, *_: object, **__: object) -> dict[str, object]:
                if path.name.startswith("shard-"):
                    return {"assessments": [duplicate_control]}
                return {"assessments": []}

            with patch("rule1_ingest.mitigation_mappings.load_inputs", return_value=(self.controls, self.mitigations)), patch(
                "rule1_ingest.mitigation_mappings.load_assessments", side_effect=duplicate_control_payload
            ), patch("rule1_ingest.mitigation_mappings.shard_controls", return_value=self.controls):
                with self.assertRaisesRegex(ValueError, "duplicate control ID"):
                    merge_shards(Path(directory), shard_dir, output, require_complete=False)

            rows = [
                {"control_id": "ism-0001", "candidates": [{"candidate_id": "duplicate-candidate"}]},
                {"control_id": "ism-0002", "candidates": [{"candidate_id": "duplicate-candidate"}]},
            ]

            def duplicate_candidate_payload(path: Path, *_: object, **__: object) -> dict[str, object]:
                index = int(path.stem.rsplit("-", 1)[1])
                return {"assessments": [rows[index]]}

            with patch("rule1_ingest.mitigation_mappings.load_inputs", return_value=(self.controls, self.mitigations)), patch(
                "rule1_ingest.mitigation_mappings.load_assessments", side_effect=duplicate_candidate_payload
            ), patch("rule1_ingest.mitigation_mappings.shard_controls", return_value=self.controls):
                with self.assertRaisesRegex(ValueError, "duplicate candidate ID"):
                    merge_shards(Path(directory), shard_dir, output, require_complete=False)


class MitigationCanaryTests(unittest.TestCase):
    @staticmethod
    def payload(edges: set[tuple[str, str, str]]) -> dict[str, object]:
        assessments = []
        for control_id in CANARY_CONTROL_IDS:
            candidates = [
                {"mitigation_id": mitigation_id, "security_function": security_function}
                for edge_control, mitigation_id, security_function in sorted(edges)
                if edge_control == control_id
            ]
            assessments.append({
                "control_id": control_id,
                "disposition": "mapped" if candidates else "unmapped",
                "candidates": candidates,
            })
        return {"assessments": assessments}

    def test_canary_contract_has_required_positives_and_single_optional_precision_edge(self) -> None:
        self.assertEqual(
            CANARY_REQUIRED_EDGES,
            {
                ("ism-0109", "M1047", "detect"),
                ("ism-1511", "M1053", "recover"),
                ("ism-1547", "M1053", "recover"),
            },
        )
        self.assertEqual(
            CANARY_ALLOWED_EDGES - CANARY_REQUIRED_EDGES,
            {("ism-0133", "M1022", "protect")},
        )

    def test_canary_verifier_accepts_exact_allowlist_and_optional_edge(self) -> None:
        payload = self.payload(set(CANARY_ALLOWED_EDGES))
        with patch("rule1_ingest.mitigation_mappings.load_assessments", return_value=payload):
            self.assertIs(verify_canary(Path("canary.json"), [], []), payload)

    def test_canary_verifier_rejects_missing_positive_and_forbidden_edge(self) -> None:
        missing = self.payload(set(CANARY_REQUIRED_EDGES) - {("ism-0109", "M1047", "detect")})
        with patch("rule1_ingest.mitigation_mappings.load_assessments", return_value=missing):
            with self.assertRaisesRegex(ValueError, "required edge is absent"):
                verify_canary(Path("canary.json"), [], [])
        forbidden = self.payload(set(CANARY_REQUIRED_EDGES) | {("ism-0133", "M1029", "protect")})
        with patch("rule1_ingest.mitigation_mappings.load_assessments", return_value=forbidden):
            with self.assertRaisesRegex(ValueError, "outside the conservative allowlist"):
                verify_canary(Path("canary.json"), [], [])


if __name__ == "__main__":
    unittest.main()
