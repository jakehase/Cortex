from __future__ import annotations

import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "detached_job_notifier.py"
SPEC = importlib.util.spec_from_file_location("detached_job_notifier", SCRIPT)
assert SPEC and SPEC.loader
notifier = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(notifier)


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _blocked_state(**overrides):
    state = {
        "schemaVersion": notifier.TERMINAL_STATE_SCHEMA,
        "jobId": "hardening",
        "runId": "run-001",
        "status": "blocked",
        "completedAt": _now(),
        "terminalSequence": 1,
        "verificationPassed": False,
        "blocker": "boom",
        "truthBoundary": "Terminal state only; no completion is claimed.",
    }
    state.update(overrides)
    return state


def _completed_state(root: Path, **overrides):
    artifact = root / str(overrides.pop("artifact_name", "result.json"))
    artifact.write_text('{"ok":true}\n', encoding="utf-8")
    state = {
        "schemaVersion": notifier.TERMINAL_STATE_SCHEMA,
        "jobId": "hardening",
        "runId": "run-001",
        "status": "completed",
        "completedAt": _now(),
        "terminalSequence": 1,
        "verificationPassed": True,
        "artifactManifest": {
            "path": str(artifact),
            "sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
        },
        "truthBoundary": "The named artifact alone was verified.",
    }
    state.update(overrides)
    return state


def _ack(message_id: str = "proof-1") -> str:
    return json.dumps(
        {
            "schemaVersion": "openclaw.message.delivery.v1",
            "ok": True,
            "messageId": message_id,
        },
        separators=(",", ":"),
    )


class DetachedJobNotifierTests(unittest.TestCase):
    def test_key_ignores_non_authoritative_update_but_binds_terminal_revision(self) -> None:
        first = _blocked_state(candidateHead="abc", blocker="one", updatedAt="1")
        second = {**first, "updatedAt": "2"}
        third = {**second, "blocker": "two"}
        fourth = {**second, "runId": "run-002"}
        fifth = {**second, "terminalSequence": 2}
        self.assertEqual(notifier.notification_key("job", "source", first), notifier.notification_key("job", "source", second))
        self.assertNotEqual(notifier.notification_key("job", "source", second), notifier.notification_key("job", "source", third))
        self.assertNotEqual(notifier.notification_key("job", "source", second), notifier.notification_key("job", "source", fourth))
        self.assertNotEqual(notifier.notification_key("job", "source", second), notifier.notification_key("job", "source", fifth))

    def test_blocked_message_contains_truth_fields(self) -> None:
        message = notifier.format_message(
            "hardening",
            _blocked_state(candidateHead="abc123", blocker="validation failed"),
        )
        self.assertIn("BLOCKED", message)
        self.assertIn("Head: abc123", message)
        self.assertIn("Blocker: validation failed", message)
        self.assertIn("Run: run-001", message)
        self.assertIn("Verification passed: false", message)
        self.assertIn("Truth boundary: Terminal state only", message)

    def test_live_delivery_is_deduplicated(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            state = root / "state.json"
            ledger = root / "ledger.json"
            send_log = root / "sends.log"
            sender = root / "sender"
            state.write_text(json.dumps(_blocked_state(candidateHead="abc")))
            sender.write_text(
                f"#!/bin/sh\nprintf 'send\\n' >> \"$FAKE_SEND_LOG\"\nprintf '%s\\n' '{_ack()}'\n"
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
            self.assertEqual(json.loads(ledger.read_text())["attempts"], {})

    def test_grace_period_suppresses_a_recovered_blocker(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            state = root / "state.json"
            ledger = root / "ledger.json"
            send_log = root / "sends.log"
            sender = root / "sender"
            state.write_text(json.dumps(_blocked_state(candidateHead="abc", blocker="temporary")))
            sender.write_text(
                f"#!/bin/sh\nprintf 'send\\n' >> \"$FAKE_SEND_LOG\"\nprintf '%s\\n' '{_ack()}'\n"
            )
            sender.chmod(0o755)

            def recover() -> None:
                time.sleep(0.03)
                state.write_text(json.dumps({"status": "validating_full", "candidateHead": "abc"}))

            thread = threading.Thread(target=recover)
            thread.start()
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
                    "--terminal-grace-seconds",
                    "0.1",
                    "--once",
                ],
                env={**os.environ, "FAKE_SEND_LOG": str(send_log)},
                capture_output=True,
                text=True,
                check=False,
            )
            thread.join()
            self.assertEqual(result.returncode, 3, result.stderr)
            self.assertFalse(send_log.exists())
            self.assertFalse(ledger.exists())

    def test_grace_period_delivers_a_persistent_blocker(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            state = root / "state.json"
            ledger = root / "ledger.json"
            sender = root / "sender"
            state.write_text(json.dumps(_blocked_state(candidateHead="abc", blocker="persistent")))
            sender.write_text(f"#!/bin/sh\nprintf '%s\\n' '{_ack('proof-grace')}'\n")
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
                    "--terminal-grace-seconds",
                    "0.05",
                    "--once",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(len(json.loads(ledger.read_text())["delivered"]), 1)

    def test_sender_failure_is_not_marked_delivered(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            state = root / "state.json"
            ledger = root / "ledger.json"
            sender = root / "sender"
            state.write_text(json.dumps(_blocked_state(status="failed", error="boom", blocker=None)))
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
            self.assertIn("delivery outcome uncertain", result.stderr)
            pending = json.loads(ledger.read_text())
            self.assertEqual(len(pending["attempts"]), 1)
            self.assertEqual(pending["delivered"], {})

    def test_success_state_requires_fresh_verified_matching_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            valid = _completed_state(root)
            validated = notifier.validate_terminal_state(valid)
            self.assertEqual(validated["artifactManifest"]["sha256"], valid["artifactManifest"]["sha256"])

            with self.assertRaisesRegex(notifier.NotifierError, "verificationPassed=true"):
                notifier.validate_terminal_state({**valid, "verificationPassed": False})
            with self.assertRaisesRegex(notifier.NotifierError, "does not match"):
                notifier.validate_terminal_state({
                    **valid,
                    "artifactManifest": {**valid["artifactManifest"], "sha256": "0" * 64},
                })
            with self.assertRaisesRegex(notifier.NotifierError, "stale"):
                notifier.validate_terminal_state(
                    {**valid, "completedAt": "2000-01-01T00:00:00Z"},
                    max_age_seconds=60,
                )
            for unbounded_age in (float("inf"), notifier.DEFAULT_MAX_STATE_AGE_SECONDS + 1):
                with self.assertRaisesRegex(notifier.NotifierError, "max state age"):
                    notifier.validate_terminal_state(valid, max_age_seconds=unbounded_age)
            with self.assertRaisesRegex(notifier.NotifierError, "truthBoundary"):
                notifier.validate_terminal_state({**valid, "truthBoundary": ""})
            with self.assertRaisesRegex(notifier.NotifierError, "must be absolute"):
                notifier.validate_terminal_state({
                    **valid,
                    "artifactManifest": {
                        **valid["artifactManifest"],
                        "path": "relative-result.json",
                    },
                })

    def test_each_terminal_revision_field_has_a_distinct_delivery_key(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            first = notifier.validate_terminal_state(_completed_state(root))
            first_key = notifier.notification_key("job", "source", first)
            variants = [
                {**first, "runId": "run-002"},
                {**first, "completedAt": "2026-08-23T00:00:01Z"},
                {**first, "terminalSequence": 2},
                {
                    **first,
                    "artifactManifest": {
                        **first["artifactManifest"],
                        "path": str(root / "other-result.json"),
                    },
                },
                {
                    **first,
                    "artifactManifest": {
                        **first["artifactManifest"],
                        "sha256": "1" * 64,
                    },
                },
                {**first, "truthBoundary": "A corrected claim boundary."},
            ]
            for variant in variants:
                self.assertNotEqual(
                    first_key,
                    notifier.notification_key("job", "source", variant),
                )

    def test_sender_exit_zero_requires_versioned_positive_ack_and_message_id(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            sender = root / "sender"
            sender.write_text("#!/bin/sh\nprintf '{\"ok\":false,\"delivery\":\"rejected\"}\\n'\n")
            sender.chmod(0o755)
            with self.assertRaisesRegex(notifier.NotifierError, "schema"):
                notifier.send_message(
                    sender=str(sender), channel="test", account="test", target="target",
                    message="message", idempotency_key="a" * 64,
                    idempotency_flag=None, dry_run=False,
                )

            sender.write_text(
                "#!/bin/sh\nprintf '{\"schemaVersion\":\"openclaw.message.delivery.v1\","
                "\"ok\":false,\"delivery\":\"rejected\"}\\n'\n"
            )
            with self.assertRaisesRegex(notifier.DeliveryRejected, "rejected"):
                notifier.send_message(
                    sender=str(sender), channel="test", account="test", target="target",
                    message="message", idempotency_key="a" * 64,
                    idempotency_flag=None, dry_run=False,
                )

            sender.write_text("#!/bin/sh\nprintf '{\"schemaVersion\":\"openclaw.message.delivery.v1\",\"ok\":true}\\n'\n")
            with self.assertRaisesRegex(notifier.NotifierError, "no message ID"):
                notifier.send_message(
                    sender=str(sender), channel="test", account="test", target="target",
                    message="message", idempotency_key="a" * 64,
                    idempotency_flag=None, dry_run=False,
                )

    def test_negative_ack_is_never_ledgered_as_delivered(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            ledger = root / "ledger.json"
            args = notifier.build_parser().parse_args([
                "--state-file", str(root / "state.json"), "--job-label", "job",
                "--target", "target", "--dedupe-file", str(ledger), "--once",
            ])
            with mock.patch.object(
                notifier,
                "send_message",
                side_effect=notifier.DeliveryRejected("sender positively rejected delivery"),
            ):
                with self.assertRaises(notifier.DeliveryRejected):
                    notifier.process_terminal_state(args, _blocked_state())
            payload = json.loads(ledger.read_text(encoding="utf-8"))
            self.assertEqual(payload["attempts"], {})
            self.assertEqual(payload["delivered"], {})

    def test_unversioned_negative_ack_remains_fenced_as_uncertain(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            ledger = root / "ledger.json"
            send_log = root / "sends.log"
            sender = root / "sender"
            sender.write_text(
                "#!/bin/sh\nprintf 'send\\n' >> \"$FAKE_SEND_LOG\"\n"
                "printf '{\"ok\":false,\"delivery\":\"rejected\"}\\n'\n"
            )
            sender.chmod(0o755)
            args = notifier.build_parser().parse_args([
                "--state-file", str(root / "state.json"), "--job-label", "job",
                "--target", "target", "--dedupe-file", str(ledger),
                "--sender", str(sender), "--once",
            ])
            with mock.patch.dict(os.environ, {"FAKE_SEND_LOG": str(send_log)}):
                with self.assertRaisesRegex(notifier.NotifierError, "schema"):
                    notifier.process_terminal_state(args, _blocked_state())
                with self.assertRaisesRegex(notifier.NotifierError, "delivery_outcome_uncertain"):
                    notifier.process_terminal_state(args, _blocked_state())
            payload = json.loads(ledger.read_text(encoding="utf-8"))
            self.assertEqual(len(payload["attempts"]), 1)
            self.assertEqual(payload["delivered"], {})
            self.assertEqual(send_log.read_text().splitlines(), ["send"])

    def test_sender_start_failure_clears_attempt_for_safe_retry(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            ledger = root / "ledger.json"
            args = notifier.build_parser().parse_args([
                "--state-file", str(root / "state.json"), "--job-label", "job",
                "--target", "target", "--dedupe-file", str(ledger),
                "--sender", str(root / "missing-sender"), "--once",
            ])
            with self.assertRaises(notifier.DeliveryNotAttempted):
                notifier.process_terminal_state(args, _blocked_state())
            payload = json.loads(ledger.read_text(encoding="utf-8"))
            self.assertEqual(payload["attempts"], {})
            self.assertEqual(payload["delivered"], {})

    def test_crash_after_send_is_fenced_before_retry(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            ledger = root / "ledger.json"
            send_count = 0
            write_count = 0
            real_write = notifier.atomic_write_json

            def send(**_kwargs):
                nonlocal send_count
                send_count += 1
                return json.loads(_ack("crash-window"))

            def crash_on_delivery(path, payload):
                nonlocal write_count
                write_count += 1
                if write_count == 2:
                    raise OSError("simulated crash after provider acknowledgement")
                real_write(path, payload)

            args = notifier.build_parser().parse_args([
                "--state-file", str(root / "state.json"), "--job-label", "job",
                "--target", "target", "--dedupe-file", str(ledger), "--once",
            ])
            state = _blocked_state()
            with mock.patch.object(notifier, "send_message", side_effect=send), mock.patch.object(
                notifier, "atomic_write_json", side_effect=crash_on_delivery
            ):
                with self.assertRaisesRegex(OSError, "simulated crash"):
                    notifier.process_terminal_state(args, state)
            self.assertEqual(send_count, 1)
            with mock.patch.object(notifier, "send_message", side_effect=send):
                with self.assertRaisesRegex(notifier.NotifierError, "delivery_outcome_uncertain"):
                    notifier.process_terminal_state(args, state)
            self.assertEqual(send_count, 1)


if __name__ == "__main__":
    unittest.main()
