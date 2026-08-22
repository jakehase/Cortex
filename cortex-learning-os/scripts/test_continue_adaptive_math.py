#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import datetime as dt
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().with_name("continue_adaptive_math.py")
SPEC = importlib.util.spec_from_file_location("continue_adaptive_math", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class ContinueAdaptiveMathTests(unittest.TestCase):
    def test_launcher_output_parser_ignores_surrounding_logs(self):
        value = MODULE.parse_launcher_output('prefix {"noise":true}\n{"ok":true,"runId":"math-training-20260727T050000Z-abc123"}\nsuffix')
        self.assertEqual(value["runId"], "math-training-20260727T050000Z-abc123")

    def test_child_progress_requires_a_higher_signed_revision(self):
        child = {
            "status": "completed",
            "adaptiveArtifactStatus": "candidate_acquisition_delta",
            "acquisitionRevision": 8,
        }
        self.assertEqual(MODULE.evaluate_child(child, 7), ("continue", None, 8))
        action, reason, revision = MODULE.evaluate_child({**child, "acquisitionRevision": 7}, 7)
        self.assertEqual(action, "blocked")
        self.assertIn("no canonical acquisition progress", reason)
        self.assertEqual(revision, 7)

    def test_child_blocker_and_curriculum_frontier_are_terminal(self):
        blocked = {"status": "blocked", "reason": "attempt budget exhausted"}
        self.assertEqual(MODULE.evaluate_child(blocked, 4), ("blocked", "attempt budget exhausted", 4))
        frontier = {
            "status": "completed",
            "adaptiveArtifactStatus": "curriculum_frontier_reached",
            "acquisitionRevision": 4,
        }
        self.assertEqual(MODULE.evaluate_child(frontier, 4), ("frontier", None, 4))
        with self.assertRaisesRegex(MODULE.ContinuationBlocker, "unexpectedly changed"):
            MODULE.evaluate_child({**frontier, "acquisitionRevision": 5}, 4)

    def test_active_continuation_contains_no_review_wait_path(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("earliest_future_review", source)
        self.assertNotIn("next signed review", source)
        self.assertIn('SCHEMA = "cortex.learning_os.math_continuation.v2"', source)
        self.assertIn('CURRICULUM_FRONTIER = "curriculum_frontier_reached"', source)
        self.assertIn('"reviewSelectionEnabled": False', source)

    def test_production_boundary_is_xhigh_remote_and_independently_harvested(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('"--adaptive", "--thinking", "xhigh", "--no-notify"', source)
        self.assertIn('"executionPlane": "Hetzner detached Codex worker"', source)
        self.assertIn('"controlPlane": "lightweight supervisor, independent harvester, and notifier"', source)
        self.assertIn("canonical source marker drifted from origin/main", source)
        self.assertIn("adaptive child made no canonical acquisition progress", source)
        self.assertIn("continuation reached the {args.max_sessions}-session safety boundary", source)
        self.assertIn("args.max_sessions > 100", source)
        self.assertIn("args.max_wall_seconds > 86_400", source)
        self.assertIn("args.child_timeout_seconds > 14_400", source)

    def test_hard_safety_caps_reject_expansion(self):
        with tempfile.TemporaryDirectory() as temporary:
            temporary_path = Path(temporary)
            acquisition_state = temporary_path / "mastery.json"
            assessment_bank = temporary_path / "assessment-bank.json"
            source_marker = temporary_path / "source"
            acquisition_state.write_text("{}\n", encoding="utf-8")
            assessment_bank.write_text("{}\n", encoding="utf-8")
            source_marker.write_text("a" * 40 + "\n", encoding="utf-8")
            base = dict(
                continuation_id="math-continuation-20260727T050000Z-abc123",
                launcher=SCRIPT,
                live_control=SCRIPT,
                acquisition_state=acquisition_state,
                assessment_bank=assessment_bank,
                source_marker=source_marker,
                max_sessions=100,
                child_timeout_seconds=14_400,
                max_wall_seconds=86_400,
                ssh_host="root@example.invalid",
                remote_repo="/home/jake/clawd-remote",
            )
            self.assertTrue(os.access(SCRIPT, os.X_OK))
            MODULE.validate_arguments(SimpleNamespace(**base))
            for field, value, message in [
                ("max_sessions", 101, "hard cap of 100"),
                ("child_timeout_seconds", 14_401, "four-hour hard cap"),
                ("max_wall_seconds", 86_401, "24-hour hard cap"),
            ]:
                with self.assertRaisesRegex(MODULE.ContinuationBlocker, message):
                    MODULE.validate_arguments(SimpleNamespace(**{**base, field: value}))

    def test_persisted_child_and_wall_deadlines_do_not_reset_on_resume(self):
        expired = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=200)).isoformat().replace("+00:00", "Z")
        current = MODULE.utc_now()
        with tempfile.TemporaryDirectory() as temporary:
            missing = Path(temporary) / "missing-child.json"
            with self.assertRaisesRegex(MODULE.ContinuationBlocker, "child run timed out"):
                MODULE.wait_for_child(
                    missing,
                    poll_seconds=1,
                    timeout_seconds=60,
                    launched_at=expired,
                    continuation_started_at=current,
                    max_wall_seconds=300,
                )
            with self.assertRaisesRegex(MODULE.ContinuationBlocker, "wall-time safety boundary"):
                MODULE.wait_for_child(
                    missing,
                    poll_seconds=1,
                    timeout_seconds=14_400,
                    launched_at=current,
                    continuation_started_at=expired,
                    max_wall_seconds=60,
                )


if __name__ == "__main__":
    unittest.main()
