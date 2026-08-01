import base64
import datetime
import hashlib
import importlib.util
import json
import pathlib
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest import mock


MODULE_PATH = pathlib.Path(__file__).with_name("harvest-phd-qualification.py")
SPEC = importlib.util.spec_from_file_location("harvest_phd_qualification", MODULE_PATH)
HARVEST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HARVEST)
SIGNING_SECRET = "fixture-harvest-signing-secret-000000000000000000"


def pretty_bytes(value: object) -> bytes:
    return (json.dumps(value, indent=2) + "\n").encode()


class HarvestValidationTests(unittest.TestCase):
    def test_campaign_lock_serializes_processes_and_recovers_on_crash(self):
        with tempfile.TemporaryDirectory() as temporary:
            campaign_root = pathlib.Path(temporary) / "campaign"
            campaign_root.mkdir(mode=0o700)
            state_file = campaign_root / "state.json"
            lock_file = campaign_root / HARVEST.HARVEST_LOCK_NAME
            first_ready = pathlib.Path(temporary) / "first.ready"
            second_ready = pathlib.Path(temporary) / "second.ready"
            child = """
import importlib.util
import os
import pathlib
import sys
import time

spec = importlib.util.spec_from_file_location("harvest", sys.argv[1])
harvest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harvest)
descriptor = harvest.acquire_campaign_harvest_lock(
    pathlib.Path(sys.argv[2]),
    pathlib.Path(sys.argv[3]),
)
pathlib.Path(sys.argv[4]).write_text("acquired\\n", encoding="utf-8")
time.sleep(float(sys.argv[5]))
os.close(descriptor)
"""
            first = subprocess.Popen([
                sys.executable,
                "-c",
                child,
                str(MODULE_PATH),
                str(lock_file),
                str(state_file),
                str(first_ready),
                "60",
            ])
            second = None
            try:
                deadline = time.monotonic() + 5
                while not first_ready.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(first_ready.exists(), "first harvester did not acquire lock")
                second = subprocess.Popen([
                    sys.executable,
                    "-c",
                    child,
                    str(MODULE_PATH),
                    str(lock_file),
                    str(state_file),
                    str(second_ready),
                    "0",
                ])
                time.sleep(0.2)
                self.assertFalse(
                    second_ready.exists(),
                    "competing harvester entered the campaign mutation section",
                )
                first.kill()
                first.wait(timeout=5)
                second.wait(timeout=5)
                self.assertEqual(second.returncode, 0)
                self.assertTrue(
                    second_ready.exists(),
                    "kernel lock was not released after the first harvester crashed",
                )
            finally:
                if first.poll() is None:
                    first.kill()
                    first.wait(timeout=5)
                if second is not None and second.poll() is None:
                    second.kill()
                    second.wait(timeout=5)

    def test_harvest_state_is_monotonic_compare_and_swap_across_crash_cuts(self):
        with tempfile.TemporaryDirectory() as temporary:
            campaign_root = pathlib.Path(temporary) / "campaign"
            campaign_root.mkdir(mode=0o700)
            state_file = campaign_root / "state.json"
            args = SimpleNamespace(
                jobs=str(campaign_root / "plan.v2.json"),
                secret=str(campaign_root / "qualification.hmac"),
                expected_plan_digest="1" * 64,
                expected_subject_id="candidate-one",
                expected_campaign_id="campaign-one",
                expected_campaign_digest="2" * 64,
                expected_deployment_digest="3" * 64,
                expected_key_id=hashlib.sha256(
                    SIGNING_SECRET.encode()
                ).hexdigest()[:16],
                expected_descriptor_set_sha256="4" * 64,
                expected_job_count=1,
                expected_job_set_sha256="5" * 64,
                expected_product_tree="6" * 40,
                expected_runtime_sha256="7" * 64,
                expected_closure_sha256="8" * 64,
            )

            def payload(status):
                return HARVEST.state_payload(
                    args,
                    status=status,
                    artifact_root=campaign_root / "artifacts",
                    failures=[],
                    observed=1 if status == "ready_for_independent_replay" else 0,
                    succeeded=1 if status == "ready_for_independent_replay" else 0,
                    failed=0,
                    receipts=[],
                    truth_boundary="Fixture state transition is not qualification evidence.",
                )

            disposition, running_sha = HARVEST.publish_harvest_state(
                state_file,
                payload("running"),
                expected_sha256=None,
                args=args,
                signing_secret=SIGNING_SECRET,
            )
            self.assertEqual(disposition, "published")

            def crash_before_replace(phase):
                if phase == "after_state_fsync":
                    raise RuntimeError("crash:after_state_fsync")

            with self.assertRaisesRegex(RuntimeError, "crash:after_state_fsync"):
                HARVEST.publish_harvest_state(
                    state_file,
                    payload("failed"),
                    expected_sha256=running_sha,
                    args=args,
                    signing_secret=SIGNING_SECRET,
                    crash_injector=crash_before_replace,
                )
            predecessor, predecessor_sha = HARVEST.read_harvest_state(state_file)
            self.assertEqual(predecessor["status"], "running")
            self.assertEqual(predecessor_sha, running_sha)

            crash_input = campaign_root / "state-crash-input.json"
            crash_input.write_text(json.dumps({
                "module": str(MODULE_PATH),
                "target": str(state_file),
                "payload": payload("ready_for_independent_replay"),
                "expected_sha256": running_sha,
                "args": vars(args),
                "signing_secret": SIGNING_SECRET,
            }), encoding="utf-8")
            crash_child = """
import importlib.util
import json
import os
import pathlib
import signal
import sys
from types import SimpleNamespace

record = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
spec = importlib.util.spec_from_file_location("harvest_crash", record["module"])
harvest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harvest)
def crash(phase):
    if phase == "after_state_replace_before_parent_fsync":
        os.kill(os.getpid(), signal.SIGKILL)
harvest.publish_harvest_state(
    pathlib.Path(record["target"]),
    record["payload"],
    expected_sha256=record["expected_sha256"],
    args=SimpleNamespace(**record["args"]),
    signing_secret=record["signing_secret"],
    crash_injector=crash,
)
"""
            interrupted = subprocess.run([
                sys.executable,
                "-c",
                crash_child,
                str(crash_input),
            ], check=False)
            self.assertEqual(interrupted.returncode, -signal.SIGKILL)
            ready, ready_sha = HARVEST.read_harvest_state(state_file)
            self.assertEqual(ready["status"], "ready_for_independent_replay")
            self.assertTrue(HARVEST.state_matches_campaign(ready, args, SIGNING_SECRET))

            for attempted_status in ("running", "failed"):
                disposition, adopted_sha = HARVEST.publish_harvest_state(
                    state_file,
                    payload(attempted_status),
                    expected_sha256=running_sha,
                    args=args,
                    signing_secret=SIGNING_SECRET,
                )
                self.assertEqual(disposition, "adopted_ready")
                self.assertEqual(adopted_sha, ready_sha)
                durable, durable_sha = HARVEST.read_harvest_state(state_file)
                self.assertEqual(durable["status"], "ready_for_independent_replay")
                self.assertEqual(durable_sha, ready_sha)

    def test_restart_after_expiry_uses_read_only_archival_verification(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            plan_path = root / "plan.json"
            secret_path = root / "qualification.hmac"
            plan = {
                "schemaVersion": "cortex.learning_os.phd_detached_job_plan.v2",
                "subjectId": "candidate-one",
                "campaignId": "campaign-one",
                "campaignDigest": "2" * 64,
                "expiresAt": "2026-07-28T11:00:00.000Z",
                "jobs": [{"jobId": "campaign-one.exam-one"}],
            }
            plan_path.write_bytes(pretty_bytes(plan))
            secret_path.write_text(f"{SIGNING_SECRET}\n", encoding="utf-8")
            plan_path.chmod(0o600)
            secret_path.chmod(0o600)
            verification = {
                "planDigest": HARVEST.canonical_digest(plan),
                "subjectId": plan["subjectId"],
                "campaignId": plan["campaignId"],
                "campaignDigest": plan["campaignDigest"],
                "deploymentDigest": "3" * 64,
                "descriptorSetSha256": "4" * 64,
                "jobCount": 1,
                "jobSetSha256": HARVEST.canonical_digest(["campaign-one.exam-one"]),
                "productTree": "5" * 40,
                "runtimeSha256": "6" * 64,
                "closureSha256": "7" * 64,
                "jobIds": ["campaign-one.exam-one"],
                "jobDigests": {"campaign-one.exam-one": "8" * 64},
            }
            args = type("Args", (), {
                "jobs": str(plan_path),
                "secret": str(secret_path),
                "verifier": "/product/phd-qualification-launch.mjs",
                "checkout_root": "/immutable/checkout",
                "expected_plan_digest": verification["planDigest"],
                "expected_subject_id": verification["subjectId"],
                "expected_campaign_id": verification["campaignId"],
                "expected_campaign_digest": verification["campaignDigest"],
                "expected_deployment_digest": verification["deploymentDigest"],
                "expected_key_id": hashlib.sha256(
                    SIGNING_SECRET.encode()
                ).hexdigest()[:16],
                "expected_descriptor_set_sha256": verification["descriptorSetSha256"],
                "expected_job_count": verification["jobCount"],
                "expected_job_set_sha256": verification["jobSetSha256"],
                "expected_product_tree": verification["productTree"],
                "expected_runtime_sha256": verification["runtimeSha256"],
                "expected_closure_sha256": verification["closureSha256"],
            })()
            completed = type("Completed", (), {
                "returncode": 0,
                "stdout": json.dumps({
                    **verification,
                    "authenticatedPlan": plan,
                }),
            })()
            with mock.patch.object(HARVEST.subprocess, "run", return_value=completed) as run:
                recovered_plan, recovered = HARVEST.verify_authenticated_plan(args)
            self.assertEqual(recovered_plan, plan)
            self.assertEqual(recovered, verification)
            command = run.call_args.args[0]
            self.assertIn("verify-harvest-checkout", command)
            self.assertNotIn("materialize-job", command)
            self.assertTrue(HARVEST.archival_recovery_after_expiry(
                plan,
                datetime.datetime(2026, 7, 28, 11, 0, 1, tzinfo=datetime.timezone.utc),
            ))
            self.assertIsNone(HARVEST.expired_missing_terminal_failure(
                "campaign-one.exam-one",
                {"campaign-one.exam-one"},
                archival_after_expiry=True,
            ))
            missing = HARVEST.expired_missing_terminal_failure(
                "campaign-one.exam-one",
                set(),
                archival_after_expiry=True,
            )
            self.assertIn("cannot relaunch", missing["reason"])
            self.assertIn("new campaign", missing["reason"])

    def fixture(
        self,
        root: pathlib.Path,
        executor: str = "model_no_tools",
        started_at: object = "2026-07-28T10:00:00.000Z",
        completed_at: object = "2026-07-28T10:05:00.000Z",
    ) -> dict:
        prompt = b"fixture exact prompt"
        source_bundle = {
            "schemaVersion": "cortex.learning_os.research_source_bundle.v1",
            "entrypoint": "run.mjs",
        }
        source_bytes = HARVEST.canonical_json(source_bundle).encode()
        job = HARVEST.sign_record({
            "schemaVersion": "cortex.learning_os.phd_detached_job.v2",
            "jobId": "job-one",
            "campaignId": "campaign-one",
            "campaignDigest": "2" * 64,
            "executor": executor,
            "deployment": {
                "schemaVersion": "cortex.learning_os.deployment_binding.v1",
                "sourceCommit": "a" * 40,
                "sourceTree": "b" * 40,
                "contentDigests": {"graph": "c" * 64},
            },
            "promptBase64": base64.b64encode(prompt).decode(),
            "promptSha256": hashlib.sha256(prompt).hexdigest(),
            "descriptorSha256": "e" * 64,
            "idempotencyKey": "f" * 64,
            "notBefore": "2026-07-28T09:00:00.000Z",
            "expiresAt": "2026-07-28T11:00:00.000Z",
            "task": {
                "sourceBundle": source_bundle,
                "sourceBundleSha256": hashlib.sha256(source_bytes).hexdigest(),
            } if executor == "frozen_research_reproduction" else {},
        }, SIGNING_SECRET)
        job_digest = HARVEST.canonical_digest(job)
        execution_identity = {
            "planDigest": "1" * 64,
            "campaignDigest": "2" * 64,
            "descriptorSetSha256": "3" * 64,
            "productTree": "4" * 40,
            "runtimeSha256": "5" * 64,
            "closureSha256": "6" * 64,
        }
        output = b'{"answers":[]}\n'
        raw_events = (
            b'{"type":"response.completed","request_id":"req-1",'
            b'"session_id":"provider-1"}\n'
        )
        interval = {
            "jobDigest": job_digest,
            "notBefore": job["notBefore"],
            "startedAt": started_at,
            "completedAt": completed_at,
            "expiresAt": job["expiresAt"],
        }
        interval_digest = HARVEST.canonical_digest(interval)
        stderr = b""
        execution_core = {
            "schemaVersion": "cortex.learning_os.execution_evidence_core.v1",
            "bindings": {
                "jobId": job["jobId"],
                "jobSha256": job_digest,
                "campaignId": job["campaignId"],
                "campaignSha256": job["campaignDigest"],
            },
            "input": {
                "bytes": len(prompt),
                "sha256": hashlib.sha256(prompt).hexdigest(),
            },
            "outputs": {
                "raw": [
                    {
                        "name": "stdout",
                        "bytes": len(raw_events),
                        "sha256": hashlib.sha256(raw_events).hexdigest(),
                    },
                    {
                        "name": "stderr",
                        "bytes": len(stderr),
                        "sha256": hashlib.sha256(stderr).hexdigest(),
                    },
                ],
                "files": [{
                    "path": "output.json",
                    "bytes": len(output),
                    "sha256": hashlib.sha256(output).hexdigest(),
                }],
            },
        }
        call = {
            "schemaVersion": "cortex.learning_os.phd_worker_call.v2",
            "jobId": job["jobId"],
            "jobDigest": job_digest,
            "role": "exam",
            "command": "fixture-codex",
            "args": ["exec"],
            "plannedSessionId": "fixture-session",
            "providerRequestId": "fixture-request",
            "providerSessionId": "fixture-provider-session",
            "provider": "openai-codex",
            "model": "fixture-model",
            "thinking": "xhigh",
            "sandbox": "read-only",
            "toolsAllowed": False,
            "toolsUsed": [],
            "usage": {"input_tokens": 1, "output_tokens": 1},
            "positiveUsage": True,
            "isolatedDirectory": True,
            "exactPromptBytes": True,
            "promptSha256": job["promptSha256"],
            "outputSha256": hashlib.sha256(output).hexdigest(),
            "rawEventLedgerSha256": hashlib.sha256(raw_events).hexdigest(),
            "executionIdentity": execution_identity,
            "notBefore": job["notBefore"],
            "startedAt": started_at,
            "completedAt": completed_at,
            "expiresAt": job["expiresAt"],
            "executionIntervalSha256": interval_digest,
            "exitCode": 0,
            "signal": None,
            "error": None,
            "postprocessError": None,
            "evidenceError": None,
            "stderrSha256": hashlib.sha256(stderr).hexdigest(),
            "executionEvidenceCore": execution_core,
            "executionEvidenceSha256": HARVEST.canonical_digest(execution_core),
            "attestation": None,
            "provenanceStatus": "awaiting_trusted_runner_attestation",
        }
        execution = {
            "schemaVersion": "cortex.learning_os.phd_inert_execution.v2",
            "jobId": job["jobId"],
            "jobDigest": job_digest,
            "role": "fixture-inert",
            "executor": executor,
            "sessionId": "fixture-session",
            "descriptorSha256": job["descriptorSha256"],
            "idempotencyKey": job["idempotencyKey"],
            "executionIdentity": execution_identity,
            "dependencyBindings": [],
            "outputSha256": hashlib.sha256(output).hexdigest(),
            "notBefore": job["notBefore"],
            "startedAt": started_at,
            "completedAt": completed_at,
            "expiresAt": job["expiresAt"],
            "executionIntervalSha256": interval_digest,
            "authority": "worker_evidence_only",
            "canonicalStateMutated": False,
        }
        summary = {
            "schemaVersion": "cortex.learning_os.phd_worker_summary.v2",
            "jobId": job["jobId"],
            "campaignId": job["campaignId"],
            "jobDigest": job_digest,
            "executor": executor,
            "executionIdentity": execution_identity,
            "status": "candidate",
            "notBefore": job["notBefore"],
            "startedAt": started_at,
            "completedAt": completed_at,
            "expiresAt": job["expiresAt"],
            "executionIntervalSha256": interval_digest,
            "timingProvenance": "worker_observed_awaiting_execution_attestation",
            "outputSha256": hashlib.sha256(output).hexdigest(),
            "authority": "worker_evidence_only",
            "canonicalStateMutated": False,
            "truthBoundary": (
                "Fixture candidate awaits independent authenticated execution evidence."
            ),
        }
        files = {
            "job.json": pretty_bytes(job),
            "output.json": output,
            "worker-summary.json": pretty_bytes(summary),
        }
        if executor == "model_no_tools":
            files["model-call.json"] = pretty_bytes(call)
            files["raw-events.ndjson"] = raw_events
            files["stderr.raw"] = stderr
        else:
            files["execution-record.json"] = pretty_bytes(execution)
        if executor == "frozen_research_reproduction":
            reproduction_core = {
                "schemaVersion": "cortex.learning_os.execution_evidence_core.v1",
                "bindings": {
                    "jobId": job["jobId"],
                    "jobSha256": job_digest,
                    "campaignId": job["campaignId"],
                    "campaignSha256": job["campaignDigest"],
                    "sourceSha256": job["task"]["sourceBundleSha256"],
                },
                "input": {
                    "bytes": len(source_bytes),
                    "sha256": hashlib.sha256(source_bytes).hexdigest(),
                },
                "outputs": {
                    "raw": [
                        {
                            "name": "stdout",
                            "bytes": 0,
                            "sha256": hashlib.sha256(b"").hexdigest(),
                        },
                        {
                            "name": "stderr",
                            "bytes": 0,
                            "sha256": hashlib.sha256(b"").hexdigest(),
                        },
                    ],
                    "files": [],
                },
            }
            reproduction_digest = HARVEST.canonical_digest(reproduction_core)
            reproduction_request = {
                "status": "ready_for_independent_authority",
                "outputs": [],
                "executionEvidenceCore": reproduction_core,
                "executionEvidenceSha256": reproduction_digest,
                "requestedAttestationPayload": {
                    "executionEvidenceCore": reproduction_core,
                    "executionEvidenceSha256": reproduction_digest,
                },
            }
            files["reproduction-authority-request.json"] = pretty_bytes(
                reproduction_request
            )
            files["stdout.raw"] = b""
            files["stderr.raw"] = b""
        for name, content in files.items():
            (root / name).write_bytes(content)
        records = [{
            "path": name,
            "bytes": len(content),
            "ownerUid": 0,
            "ownerGid": 0,
            "mode": "0444",
            "linkCount": 1,
            "sha256": hashlib.sha256(content).hexdigest(),
        } for name, content in sorted(files.items())]
        manifest = {
            "schemaVersion": "cortex.learning_os.phd_worker_manifest.v3",
            "jobId": job["jobId"],
            "campaignId": job["campaignId"],
            "jobDigest": job_digest,
            "jobControlPlaneSignature": job["controlPlaneSignature"],
            "deployment": job["deployment"],
            "executor": executor,
            "executionIdentity": execution_identity,
            "promptSha256": job["promptSha256"],
            "status": summary["status"],
            "notBefore": job["notBefore"],
            "startedAt": started_at,
            "completedAt": completed_at,
            "expiresAt": job["expiresAt"],
            "executionIntervalSha256": interval_digest,
            "timingProvenance": summary["timingProvenance"],
            "outputSha256": summary["outputSha256"],
            "publication": {
                "schemaVersion": "cortex.learning_os.phd_terminal_publication.v1",
                "publisherUid": 0,
                "publisherGid": 0,
                "rootMode": "0555",
                "fileMode": "0444",
                "directoryMode": "0555",
                "regularFileLinkCount": 1,
                "rootLinkCount": 2,
                "producerWritableTerminal": False,
                "noFollow": True,
                "exactMetadata": True,
            },
            "directories": [],
            "files": records,
            "authority": "worker_evidence_only",
            "truthBoundary": "Fixture manifest is worker evidence only.",
        }
        (root / "artifact-manifest.json").write_bytes(pretty_bytes(manifest))
        return job, execution_identity, job_digest

    def test_accepts_complete_digest_bound_candidate_for_every_executor(self):
        for executor in (
            "model_no_tools",
            "frozen_task_materialization",
            "authority_request_materialization",
            "frozen_research_reproduction",
        ):
            with self.subTest(executor=executor), tempfile.TemporaryDirectory() as temporary:
                root = pathlib.Path(temporary)
                job, identity, job_digest = self.fixture(root, executor=executor)
                self.assertEqual(
                    HARVEST.validate_harvested(
                        root, job, identity, SIGNING_SECRET, job_digest,
                    ),
                    (True, ""),
                )
                with mock.patch.object(
                    HARVEST,
                    "canonical_runtime_validation",
                    return_value=(True, ""),
                ):
                    receipt = HARVEST.harvest_receipt(
                        root,
                        job,
                        identity,
                        SIGNING_SECRET,
                        job_digest,
                        "/immutable/checkout",
                    )
                self.assertTrue(HARVEST.verify_control_signature(receipt, SIGNING_SECRET))
                self.assertEqual(receipt["startedAt"], "2026-07-28T10:00:00.000Z")
                self.assertEqual(receipt["completedAt"], "2026-07-28T10:05:00.000Z")
                self.assertEqual(receipt["notBefore"], job["notBefore"])
                self.assertFalse(receipt["providerTimeAuthority"])

    def test_rejects_execution_started_before_signed_job_lower_bound(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            job, identity, job_digest = self.fixture(
                root,
                started_at="2026-07-28T08:59:59.999Z",
            )
            valid, reason = HARVEST.validate_harvested(
                root, job, identity, SIGNING_SECRET, job_digest,
            )
            self.assertFalse(valid)
            self.assertRegex(reason, "lower bound|timing")

    def test_authenticated_staging_remnants_are_adopted_and_mismatches_quarantined(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = pathlib.Path(temporary)
            artifact_root = base / "artifacts"
            staging_root = base / "staging"
            quarantine_root = base / "quarantine"
            for directory in (artifact_root, staging_root, quarantine_root):
                directory.mkdir(mode=0o700)
            stage = staging_root / "job-one.stage"
            stage.mkdir(mode=0o700)
            job, identity, job_digest = self.fixture(stage)
            journal = staging_root / "job-one.journal.json"
            HARVEST.atomic_json(journal, HARVEST.staging_journal(
                plan_digest=identity["planDigest"],
                job=job,
                job_digest=job_digest,
                status="copying",
                signing_secret=SIGNING_SECRET,
            ))
            adopted, reason = HARVEST.adopt_staged_terminal(
                stage=stage,
                journal_path=journal,
                target=artifact_root / job["jobId"],
                quarantine_root=quarantine_root,
                plan_digest=identity["planDigest"],
                job=job,
                job_digest=job_digest,
                execution_identity=identity,
                signing_secret=SIGNING_SECRET,
                checkout_root=None,
            )
            self.assertTrue(adopted, reason)
            self.assertEqual(
                {entry.name for entry in artifact_root.iterdir()},
                {job["jobId"]},
            )
            self.assertFalse(stage.exists())
            self.assertEqual(
                json.loads(journal.read_text(encoding="utf-8"))["status"],
                "published",
            )

            mismatch = staging_root / "job-one.stage"
            mismatch.mkdir(mode=0o700)
            (mismatch / "injected").write_text("not evidence", encoding="utf-8")
            HARVEST.atomic_json(journal, HARVEST.staging_journal(
                plan_digest=identity["planDigest"],
                job=job,
                job_digest=job_digest,
                status="copying",
                signing_secret=SIGNING_SECRET,
            ))
            adopted, reason = HARVEST.adopt_staged_terminal(
                stage=mismatch,
                journal_path=journal,
                target=artifact_root / job["jobId"],
                quarantine_root=quarantine_root,
                plan_digest=identity["planDigest"],
                job=job,
                job_digest=job_digest,
                execution_identity=identity,
                signing_secret=SIGNING_SECRET,
                checkout_root=None,
            )
            self.assertFalse(adopted)
            self.assertEqual(reason, "")
            self.assertFalse(mismatch.exists())
            self.assertGreaterEqual(len(list(quarantine_root.iterdir())), 2)

    def test_validated_staging_publication_recovers_every_crash_cut(self):
        for crash_phase in (
            "after_staging_validated_journal",
            "after_staging_target_replace",
            "after_staging_published_journal",
        ):
            with (
                self.subTest(crash_phase=crash_phase),
                tempfile.TemporaryDirectory() as temporary,
            ):
                base = pathlib.Path(temporary)
                artifact_root = base / "artifacts"
                staging_root = base / "staging"
                quarantine_root = base / "quarantine"
                for directory in (artifact_root, staging_root, quarantine_root):
                    directory.mkdir(mode=0o700)
                stage = staging_root / "job-one.stage"
                stage.mkdir(mode=0o700)
                job, identity, job_digest = self.fixture(stage)
                journal = staging_root / "job-one.journal.json"
                HARVEST.atomic_json(journal, HARVEST.staging_journal(
                    plan_digest=identity["planDigest"],
                    job=job,
                    job_digest=job_digest,
                    status="copying",
                    signing_secret=SIGNING_SECRET,
                ))

                def crash(phase):
                    if phase == crash_phase:
                        raise RuntimeError(f"crash:{phase}")

                with self.assertRaisesRegex(RuntimeError, f"crash:{crash_phase}"):
                    HARVEST.adopt_staged_terminal(
                        stage=stage,
                        journal_path=journal,
                        target=artifact_root / job["jobId"],
                        quarantine_root=quarantine_root,
                        plan_digest=identity["planDigest"],
                        job=job,
                        job_digest=job_digest,
                        execution_identity=identity,
                        signing_secret=SIGNING_SECRET,
                        checkout_root=None,
                        crash_injector=crash,
                    )

                adopted, reason = HARVEST.adopt_staged_terminal(
                    stage=stage,
                    journal_path=journal,
                    target=artifact_root / job["jobId"],
                    quarantine_root=quarantine_root,
                    plan_digest=identity["planDigest"],
                    job=job,
                    job_digest=job_digest,
                    execution_identity=identity,
                    signing_secret=SIGNING_SECRET,
                    checkout_root=None,
                )
                self.assertTrue(adopted, reason)
                self.assertFalse(stage.exists())
                self.assertTrue((artifact_root / job["jobId"]).is_dir())
                self.assertEqual(
                    json.loads(journal.read_text(encoding="utf-8"))["status"],
                    "published",
                )
                self.assertEqual(list(quarantine_root.iterdir()), [])

    def test_rejects_completion_after_expiry_and_missing_time_for_every_executor(self):
        for executor in (
            "model_no_tools",
            "frozen_task_materialization",
            "authority_request_materialization",
            "frozen_research_reproduction",
        ):
            for label, started_at, completed_at in (
                ("expired", "2026-07-28T10:00:00.000Z", "2026-07-28T11:00:00.001Z"),
                ("missing", None, "2026-07-28T10:05:00.000Z"),
            ):
                with (
                    self.subTest(executor=executor, label=label),
                    tempfile.TemporaryDirectory() as temporary,
                ):
                    root = pathlib.Path(temporary)
                    job, identity, job_digest = self.fixture(
                        root,
                        executor=executor,
                        started_at=started_at,
                        completed_at=completed_at,
                    )
                    valid, reason = HARVEST.validate_harvested(
                        root,
                        job,
                        identity,
                        SIGNING_SECRET,
                        job_digest,
                    )
                    self.assertFalse(valid)
                    self.assertIn("validation failed", reason)
            with (
                self.subTest(executor=executor, label="missing_expiry_binding"),
                tempfile.TemporaryDirectory() as temporary,
            ):
                root = pathlib.Path(temporary)
                job, identity, job_digest = self.fixture(root, executor=executor)
                summary_path = root / "worker-summary.json"
                summary = json.loads(summary_path.read_text(encoding="utf-8"))
                summary["expiresAt"] = None
                summary_path.write_bytes(pretty_bytes(summary))
                manifest_path = root / "artifact-manifest.json"
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                manifest["expiresAt"] = None
                for record in manifest["files"]:
                    if record["path"] == "worker-summary.json":
                        record["bytes"] = summary_path.stat().st_size
                        record["sha256"] = hashlib.sha256(
                            summary_path.read_bytes(),
                        ).hexdigest()
                manifest_path.write_bytes(pretty_bytes(manifest))
                valid, reason = HARVEST.validate_harvested(
                    root,
                    job,
                    identity,
                    SIGNING_SECRET,
                    job_digest,
                )
                self.assertFalse(valid)
                self.assertIn("timing", reason)

    def test_exact_authenticated_job_set_cannot_harvest_an_expired_terminal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            job, identity, job_digest = self.fixture(
                root,
                completed_at="2026-07-28T11:00:00.001Z",
            )
            valid, reason = HARVEST.validate_harvested(
                root,
                job,
                identity,
                SIGNING_SECRET,
                job_digest,
            )
            self.assertFalse(valid)
            self.assertRegex(reason, "signed job.*expiry|lower bound or expiry")

    def test_rejects_mutation_partial_artifact_and_job_substitution(self):
        for mutation in ("output", "events", "partial", "job"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary:
                root = pathlib.Path(temporary)
                job, identity, job_digest = self.fixture(root)
                if mutation == "output":
                    (root / "output.json").write_text("tampered\n", encoding="utf-8")
                elif mutation == "events":
                    (root / "raw-events.ndjson").write_text("tampered\n", encoding="utf-8")
                elif mutation == "partial":
                    (root / "worker-summary.json").unlink()
                else:
                    changed = json.loads((root / "job.json").read_text(encoding="utf-8"))
                    changed["promptSha256"] = "0" * 64
                    (root / "job.json").write_bytes(pretty_bytes(changed))
                valid, _ = HARVEST.validate_harvested(
                    root, job, identity, SIGNING_SECRET, job_digest,
                )
                self.assertFalse(valid)

    def test_receipt_issuance_requires_the_shared_canonical_terminal_contract(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            job, identity, job_digest = self.fixture(root)
            with mock.patch.object(
                HARVEST,
                "canonical_runtime_validation",
                return_value=(False, "shared terminal semantic contract rejected artifact"),
            ) as shared:
                valid, reason = HARVEST.validate_harvested(
                    root,
                    job,
                    identity,
                    SIGNING_SECRET,
                    job_digest,
                    "/immutable/checkout",
                )
                self.assertFalse(valid)
                self.assertIn("shared terminal semantic contract", reason)
                shared.assert_called_once()
                with self.assertRaisesRegex(
                    ValueError,
                    "shared terminal semantic contract",
                ):
                    HARVEST.harvest_receipt(
                        root,
                        job,
                        identity,
                        SIGNING_SECRET,
                        job_digest,
                        "/immutable/checkout",
                    )

    def test_rejects_tampered_detached_job_before_harvest_authentication(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            job, identity, job_digest = self.fixture(root)
            job["expiresAt"] = "2026-07-29T11:00:00.000Z"
            valid, reason = HARVEST.validate_harvested(
                root, job, identity, SIGNING_SECRET, job_digest,
            )
            self.assertFalse(valid)
            self.assertIn("control-plane signature mismatch", reason)

    def test_exact_authenticated_identity_rejects_closure_substitution(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            job, identity, job_digest = self.fixture(root)
            summary_path = root / "worker-summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            summary["executionIdentity"]["closureSha256"] = "0" * 64
            summary_path.write_bytes(pretty_bytes(summary))
            valid, reason = HARVEST.validate_harvested(
                root, job, identity, SIGNING_SECRET, job_digest,
            )
            self.assertFalse(valid)
            self.assertIn("execution closure", reason)

    def test_rejects_partial_injected_stale_and_substituted_remote_sets(self):
        expected = {"campaign.job-one", "campaign.job-two"}
        job_files = {f"{job_id}.json" for job_id in expected}
        HARVEST.validate_remote_exact_sets(
            expected,
            job_files,
            job_files,
            expected,
            expected,
            require_complete_terminals=True,
        )
        for changed in (
            expected - {"campaign.job-two"},
            expected | {"campaign.injected"},
        ):
            with self.assertRaisesRegex(ValueError, "partial|stale|injected"):
                HARVEST.validate_remote_exact_sets(
                    expected,
                    job_files,
                    job_files,
                    changed,
                    changed,
                    require_complete_terminals=True,
                )
        with self.assertRaisesRegex(ValueError, "non-directory"):
            HARVEST.validate_remote_exact_sets(
                expected,
                job_files,
                job_files,
                expected,
                expected - {"campaign.job-two"},
                require_complete_terminals=True,
            )


if __name__ == "__main__":
    unittest.main()
