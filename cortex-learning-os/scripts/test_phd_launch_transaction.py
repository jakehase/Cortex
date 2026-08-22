#!/usr/bin/env python3
"""Focused regressions for the exact launch transport and circuit breaker."""

from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import pwd
import grp
import stat
import tempfile
import unittest


SCRIPT_ROOT = Path(__file__).resolve().parent


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


transaction = load("phd_launch_transaction", SCRIPT_ROOT / "phd-launch-transaction.py")
inventory_module = load("phd_remote_job_inventory", SCRIPT_ROOT / "phd-remote-job-inventory.py")


class LaunchTransactionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(dir="/var/tmp")
        self.root = Path(self.temporary.name)
        os.chmod(self.root, 0o700)
        self.secret_path = self.root / "qualification.hmac"
        self.secret_path.write_text("launch-transaction-test-secret-000000000000000000000\n", encoding="utf-8")
        os.chmod(self.secret_path, 0o600)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def common_args(self) -> argparse.Namespace:
        return argparse.Namespace(
            subject_id="cortex",
            campaign_id="campaign.test",
            campaign_digest="a" * 64,
            plan_digest="b" * 64,
            deployment_digest="c" * 64,
            source_commit="d" * 40,
            source_tree="e" * 40,
            product_tree="f" * 40,
            ssh_host="root@example.invalid",
            state_root=Path("/root/state"),
            remote_state_root=Path("/var/lib/state"),
            secret=self.secret_path,
            attempt_file=self.root / "attempt" / "attempt.json",
            rehearsal_receipt_sha256="1" * 64,
        )

    def test_one_attempt_circuit_breaker_never_reopens_exact_plan(self) -> None:
        args = self.common_args()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(transaction.begin_attempt(args), 0)
        attempt_id = output.getvalue().strip()
        self.assertRegex(attempt_id, r"^[0-9a-f]{32}$")
        started = transaction.read_secure_json(args.attempt_file)
        secret = transaction.secure_secret(self.secret_path)
        self.assertTrue(transaction.verify_signature(started, secret))
        self.assertEqual(started["status"], "started")
        with self.assertRaisesRegex(transaction.CircuitBreakerError, "circuit breaker is open"):
            transaction.begin_attempt(args)

        finish = argparse.Namespace(
            secret=self.secret_path,
            attempt_file=args.attempt_file,
            attempt_id=attempt_id,
            phase="remote_job_inventory",
            exit_code=3,
        )
        self.assertEqual(transaction.finish_attempt(finish), 0)
        terminal = transaction.read_secure_json(args.attempt_file)
        self.assertTrue(transaction.verify_signature(terminal, secret))
        self.assertEqual(terminal["status"], "failed")
        self.assertEqual(terminal["phase"], "remote_job_inventory")
        self.assertEqual(terminal["completionClaim"], "not_launched")
        with self.assertRaisesRegex(transaction.CircuitBreakerError, "circuit breaker is open"):
            transaction.begin_attempt(args)

    def test_tampered_terminal_transition_is_rejected(self) -> None:
        args = self.common_args()
        with contextlib.redirect_stdout(io.StringIO()) as output:
            transaction.begin_attempt(args)
        attempt_id = output.getvalue().strip()
        finish = argparse.Namespace(
            secret=self.secret_path,
            attempt_file=args.attempt_file,
            attempt_id="0" * 32,
            phase="worker_dispatch",
            exit_code=0,
        )
        with self.assertRaisesRegex(transaction.CircuitBreakerError, "does not match"):
            transaction.finish_attempt(finish)
        self.assertEqual(transaction.read_secure_json(args.attempt_file)["attemptId"], attempt_id)

    def test_remote_inventory_preserves_spaced_metadata_as_one_record(self) -> None:
        root = self.root / "jobs"
        root.mkdir(mode=0o700)
        job = root / "campaign.test.retention.1.json"
        job.write_text("{}\n", encoding="utf-8")
        os.chmod(job, 0o440)
        self.assertEqual(inventory_module.inventory(root, "files"), [job.name])
        observed = job.stat()
        expected = (
            f"{job.name} {pwd.getpwuid(observed.st_uid).pw_name} "
            f"{grp.getgrgid(observed.st_gid).gr_name} 440"
        )
        self.assertEqual(inventory_module.inventory(root, "metadata"), [expected])

    def test_remote_inventory_rejects_non_regular_injection(self) -> None:
        root = self.root / "jobs"
        root.mkdir(mode=0o700)
        (root / "campaign.test.retention.1.json").mkdir()
        with self.assertRaisesRegex(ValueError, "non-regular"):
            inventory_module.inventory(root, "metadata")

    def test_signed_running_state_cannot_be_relabelled(self) -> None:
        secret = transaction.secure_secret(self.secret_path)
        signed = transaction.sign({
            "schemaVersion": transaction.STATE_SCHEMA,
            "status": "running",
            "providerCalls": 0,
            "modelExecutableInvoked": False,
        }, secret)
        self.assertTrue(transaction.verify_signature(signed, secret))
        signed["providerCalls"] = 1
        self.assertFalse(transaction.verify_signature(signed, secret))


if __name__ == "__main__":
    unittest.main()
