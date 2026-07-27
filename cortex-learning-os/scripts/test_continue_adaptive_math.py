#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import importlib.util
import json
from pathlib import Path
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
            "adaptiveArtifactStatus": "candidate_mastery_delta",
            "masteryRevision": 8,
        }
        self.assertEqual(MODULE.evaluate_child(child, 7), ("continue", None, 8))
        action, reason, revision = MODULE.evaluate_child({**child, "masteryRevision": 7}, 7)
        self.assertEqual(action, "blocked")
        self.assertIn("no canonical mastery progress", reason)
        self.assertEqual(revision, 7)

    def test_child_blocker_and_no_due_action_are_terminal(self):
        blocked = {"status": "blocked", "reason": "attempt budget exhausted"}
        self.assertEqual(MODULE.evaluate_child(blocked, 4), ("blocked", "attempt budget exhausted", 4))
        satisfied = {
            "status": "completed",
            "adaptiveArtifactStatus": "curriculum_currently_satisfied",
            "masteryRevision": 4,
        }
        self.assertEqual(MODULE.evaluate_child(satisfied, 4), ("no_due_action", None, 4))

    def test_earliest_future_review_excludes_past_dates(self):
        now = dt.datetime.now(dt.timezone.utc)
        earlier = (now + dt.timedelta(hours=2)).isoformat().replace("+00:00", "Z")
        later = (now + dt.timedelta(days=1)).isoformat().replace("+00:00", "Z")
        past = (now - dt.timedelta(days=1)).isoformat().replace("+00:00", "Z")
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "mastery.json"
            path.write_text(json.dumps({"concepts": {
                "past": {"nextReviewAt": past},
                "later": {"nextReviewAt": later},
                "earlier": {"nextReviewAt": earlier},
            }}), encoding="utf-8")
            self.assertEqual(MODULE.earliest_future_review(path), earlier)

    def test_production_boundary_is_xhigh_remote_and_independently_harvested(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('"--adaptive", "--thinking", "xhigh", "--no-notify"', source)
        self.assertIn('"executionPlane": "Hetzner detached Codex worker"', source)
        self.assertIn('"controlPlane": "lightweight supervisor, independent harvester, and notifier"', source)
        self.assertIn("canonical source marker drifted from origin/main", source)
        self.assertIn("adaptive child made no canonical mastery progress", source)
        self.assertIn("continuation reached the {args.max_sessions}-session safety boundary", source)


if __name__ == "__main__":
    unittest.main()
