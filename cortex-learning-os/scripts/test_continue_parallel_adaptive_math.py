#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().with_name("continue_parallel_adaptive_math.py")
SPEC = importlib.util.spec_from_file_location("continue_parallel_adaptive_math", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class ContinueParallelAdaptiveMathTests(unittest.TestCase):
    def test_descriptor_parser_ignores_logs(self):
        descriptor = MODULE.parse_descriptor(
            'log\n{"ok":true,"waveId":"math-wave-20260727T180000Z-abc123","selectedCount":4}\n'
        )
        self.assertEqual(descriptor["selectedCount"], 4)

    def test_dispatch_receipts_require_exact_remote_identity_and_merge_order(self):
        run_ids = [f"math-wave-20260727T180000Z-abc123.c0{index}" for index in range(1, 5)]
        descriptor = {
            "sourceCommit": "a" * 40,
            "sourceTree": "b" * 40,
            "thinking": "ultra",
            "selectedCount": 4,
            "dispatchedCount": 4,
            "mergeOrder": run_ids,
            "dispatchReceipts": [
                {
                    "runId": run_id,
                    "status": "running",
                    "placement": "hetzner",
                    "sourceCommit": "a" * 40,
                    "sourceTree": "b" * 40,
                    "modelThinking": "ultra",
                }
                for run_id in run_ids
            ],
        }
        self.assertEqual(len(MODULE.validate_dispatch_receipts(descriptor, 4)), 4)
        for mutation, message in [
            ({"dispatchedCount": 3}, "dispatched count"),
            ({"dispatchReceipts": descriptor["dispatchReceipts"][:1]}, "incomplete"),
            ({"mergeOrder": list(reversed(run_ids))}, "merge order"),
        ]:
            with self.assertRaisesRegex(MODULE.ParallelContinuationError, message):
                MODULE.validate_dispatch_receipts({**descriptor, **mutation}, 4)
        failed = [dict(receipt) for receipt in descriptor["dispatchReceipts"]]
        failed[0]["status"] = "failed"
        with self.assertRaisesRegex(MODULE.ParallelContinuationError, "unproved"):
            MODULE.validate_dispatch_receipts({**descriptor, "dispatchReceipts": failed}, 4)

    def test_concurrency_and_safety_caps_are_bounded(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            launcher = root / "launcher"
            acquisition = root / "mastery.json"
            source = root / "source"
            graph = root / "graph.json"
            policy = root / "policy.json"
            capsule = root / "capsule.json"
            assessment_bank = root / "assessment-bank.json"
            approved_model_executable_binding = (
                root / "approved-model-executable-binding.json"
            )
            repo_root = root / "repo"
            launcher.write_text("#!/bin/sh\n", encoding="utf-8")
            launcher.chmod(0o700)
            acquisition.write_text("{}\n", encoding="utf-8")
            source.write_text("a" * 40 + "\n", encoding="utf-8")
            repo_root.mkdir()
            for target in (
                graph,
                policy,
                capsule,
                assessment_bank,
                approved_model_executable_binding,
            ):
                target.write_text("{}\n", encoding="utf-8")
            base = dict(
                continuation_id="math-acceleration-20260727T180000Z-abc123",
                launcher=launcher,
                acquisition_state=acquisition,
                source_marker=source,
                repo_root=repo_root,
                graph=graph,
                policy=policy,
                capsule=capsule,
                assessment_bank=assessment_bank,
                approved_model_executable_binding=approved_model_executable_binding,
                remote_repo="/remote/repo",
                source_ref="refs/heads/main",
                remote_graph="/remote/graph.json",
                remote_policy="/remote/policy.json",
                remote_capsule="/remote/capsule.json",
                thinking="ultra",
                concurrency=4,
                max_waves=100,
                max_sessions=800,
                max_wall_seconds=86_400,
                wave_timeout_seconds=14_400,
                poll_seconds=15,
            )
            MODULE.validate(SimpleNamespace(**base))
            for field, value, message in [
                ("concurrency", 9, "1..8"),
                ("max_waves", 101, "1..100"),
                ("max_sessions", 801, "1..800"),
                ("poll_seconds", 1, "five seconds"),
            ]:
                with self.assertRaisesRegex(MODULE.ParallelContinuationError, message):
                    MODULE.validate(SimpleNamespace(**{**base, field: value}))

    def test_completed_wave_state_is_observed_without_polling(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / "wave.json"
            MODULE.atomic_json(state, {"status": "completed", "acquisitionRevision": 2})
            args = SimpleNamespace(max_wall_seconds=300, wave_timeout_seconds=60, poll_seconds=5)
            now = MODULE.utc_now()
            observed = MODULE.wait_for_wave(state, now, args, now)
            self.assertEqual(observed["acquisitionRevision"], 2)

    def test_persisted_deadlines_fail_before_sleep(self):
        expired = (
            dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=301)
        ).isoformat().replace("+00:00", "Z")
        current = MODULE.utc_now()
        with tempfile.TemporaryDirectory() as temporary:
            missing = Path(temporary) / "missing.json"
            args = SimpleNamespace(max_wall_seconds=300, wave_timeout_seconds=60, poll_seconds=5)
            with self.assertRaisesRegex(MODULE.ParallelContinuationError, "wall-time cap|timeout cap"):
                MODULE.wait_for_wave(missing, expired, args, expired)
            args = SimpleNamespace(max_wall_seconds=600, wave_timeout_seconds=60, poll_seconds=5)
            with self.assertRaisesRegex(MODULE.ParallelContinuationError, "timeout cap"):
                MODULE.wait_for_wave(missing, expired, args, current)

    def test_active_supervisor_has_only_acquisition_wave_termination(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('SCHEMA = "cortex.learning_os.parallel_continuation.v1"', source)
        self.assertIn('"executionPlane": "concurrent detached Hetzner Codex children"', source)
        self.assertIn('"reviewSelectionEnabled": False', source)
        self.assertIn('"curriculum_frontier_reached"', source)
        self.assertIn("validate_dispatch_receipts", source)
        self.assertNotIn("nextReviewAt", source)
        self.assertNotIn("spaced_review", source)
        self.assertNotIn("shadow", source.lower())


if __name__ == "__main__":
    unittest.main()
