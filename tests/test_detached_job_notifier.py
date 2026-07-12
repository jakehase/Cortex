from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "detached_job_notifier.py"
SPEC = importlib.util.spec_from_file_location("detached_job_notifier", SCRIPT)
assert SPEC and SPEC.loader
notifier = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(notifier)


class DetachedJobNotifierTests(unittest.TestCase):
    def test_key_ignores_timestamp_but_changes_with_blocker(self) -> None:
        first = {"status": "blocked", "candidateHead": "abc", "blocker": "one", "updatedAt": "1"}
        second = {**first, "updatedAt": "2"}
        third = {**second, "blocker": "two"}
        self.assertEqual(notifier.notification_key("job", "source", first), notifier.notification_key("job", "source", second))
        self.assertNotEqual(notifier.notification_key("job", "source", second), notifier.notification_key("job", "source", third))

    def test_blocked_message_contains_truth_fields(self) -> None:
        message = notifier.format_message(
            "hardening",
            {"status": "blocked", "candidateHead": "abc123", "blocker": "validation failed", "artifactRoot": "/tmp/run"},
        )
        self.assertIn("BLOCKED", message)
        self.assertIn("Head: abc123", message)
        self.assertIn("Blocker: validation failed", message)
        self.assertIn("Artifact: /tmp/run", message)

    def test_live_delivery_is_deduplicated(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            state = root / "state.json"
            ledger = root / "ledger.json"
            send_log = root / "sends.log"
            sender = root / "sender"
            state.write_text(json.dumps({"status": "blocked", "candidateHead": "abc", "blocker": "boom"}))
            sender.write_text(
                "#!/bin/sh\nprintf 'send\\n' >> \"$FAKE_SEND_LOG\"\nprintf '{\"ok\":true,\"messageId\":\"proof-1\"}\\n'\n"
            )
            sender.chmod(0o755)
            command = [
                sys.executable,
                str(SCRIPT),
                "--state-file",
                str(state),
                "--job-label",
                "test job",
                "--target",
                "+15555550123",
                "--sender",
                str(sender),
                "--dedupe-file",
                str(ledger),
                "--once",
            ]
            env = {**os.environ, "FAKE_SEND_LOG": str(send_log)}
            first = subprocess.run(command, env=env, capture_output=True, text=True, check=False)
            second = subprocess.run(command, env=env, capture_output=True, text=True, check=False)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(send_log.read_text().splitlines(), ["send"])
            delivered = json.loads(ledger.read_text())["delivered"]
            self.assertEqual(len(delivered), 1)

    def test_sender_failure_is_not_marked_delivered(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            state = root / "state.json"
            ledger = root / "ledger.json"
            sender = root / "sender"
            state.write_text(json.dumps({"status": "failed", "error": "boom"}))
            sender.write_text("#!/bin/sh\necho send-failed >&2\nexit 9\n")
            sender.chmod(0o755)
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--state-file",
                    str(state),
                    "--job-label",
                    "test job",
                    "--target",
                    "+15555550123",
                    "--sender",
                    str(sender),
                    "--dedupe-file",
                    str(ledger),
                    "--once",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 4)
            self.assertIn("send-failed", result.stderr)
            self.assertFalse(ledger.exists())


if __name__ == "__main__":
    unittest.main()
