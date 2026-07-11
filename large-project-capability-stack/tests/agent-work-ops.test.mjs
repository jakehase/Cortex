import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AGENT_WORK_PHASE7_OPS_PACKET_SCHEMA,
  buildBackupRestoreReadinessPacket,
  buildControlPlaneSeparationPacket,
  buildExecutionPlaneInstallManifest,
  buildHeartbeatAndArtifactSyncPacket,
  buildOperationsReadinessPacket,
  buildRemoteDoctorPacket,
  buildSecurityReadinessPacket,
  compileObjective,
  detectSecretLeaks,
  evaluateCommandPolicy,
  evaluatePathPolicy,
  verifyRun,
  buildCompletionPacket,
  redactSecrets,
  writePhase7OpsArtifacts
} from '../packages/canonical-agent-work/index.mjs';
import { backupRuntime } from '../packages/agent-work-runtime/index.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/agent-work-v1/v0-cortex-handoff.json'), 'utf8'));

function tmpDir(label = 'agent-work-ops-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), label));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function greenPhase7Inputs() {
  const installManifest = buildExecutionPlaneInstallManifest({ qualificationRoot: '/home/jake/clawd-remote/qualification/agent-work-phase7-fixture' });
  const remoteDoctor = buildRemoteDoctorPacket({
    installManifest,
    host: 'clawd-exec-hel1',
    user: 'jake',
    node: 'v22.22.2',
    npm: '10.9.7',
    rsync: '/usr/bin/rsync',
    codex: '/home/jake/.local/bin/codex',
    remoteRootExists: true,
    workspaceExists: true,
    publicCortexLinked: true,
    disk: { freeGb: 314, minFreeGb: 20 },
    hostRole: 'execution_plane'
  });
  const heartbeatPacket = buildHeartbeatAndArtifactSyncPacket({
    generatedAt: '2026-07-10T17:00:10.000Z',
    heartbeat: { running: true, heartbeatAt: '2026-07-10T17:00:00.000Z', pid: 1234 },
    logRotation: { enabled: true, maxBytes: 10_000_000, keep: 5 },
    artifactSync: { enabled: true, lastSyncOk: true, returnPath: '/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-7-ops' },
    disk: { alarmEnabled: true, freeGb: 314, minFreeGb: 20 },
    budget: { alarmEnabled: true, used: 100, limit: 1000 },
    notifier: { placement: 'control_plane' }
  });
  const controlPacket = buildControlPlaneSeparationPacket({
    emergencyStop: { available: true, procedure: 'touch STOP and stop accepting new leases' },
    gracefulDrain: { available: true, procedure: 'stop new leases, wait for accepted worker bundles, fence stale workers' },
    cancel: { durableEvent: true },
    resume: { reconcileRemoteBeforeLaunch: true },
    notifierLoss: { truthUnchanged: true, completionCreditGranted: false },
    runnerLoss: { blockerWritable: true, notifierStillAvailable: true }
  });
  const securityPacket = buildSecurityReadinessPacket({ allowedPaths: ['packages/agent-work-ops/index.mjs', 'artifacts/agent-work-v1/phase-7-ops'] });
  const backupPacket = buildBackupRestoreReadinessPacket({
    sourceDigest: sha256('phase7-source'),
    backup: { exists: true, path: '/tmp/phase7-backup/run.db.backup', sha256: sha256('backup') },
    restore: { replayGreen: true, sourceDigest: sha256('phase7-source') },
    runbook: { freshCheckoutProcedure: 'sync source, restore run.db, replay JSONL', artifactReturnProcedure: 'rsync phase-7-ops artifacts back to control plane', requiredArtifacts: ['operations_readiness_packet.json', 'surface_matrix.json'] }
  });
  return { installManifest, remoteDoctor, heartbeatPacket, controlPacket, securityPacket, backupPacket };
}

test('Phase 7 install manifest and remote doctor prove least-privilege Hetzner readiness and block weak facts', () => {
  const installManifest = buildExecutionPlaneInstallManifest({ qualificationRoot: '/home/jake/clawd-remote/qualification/agent-work-phase7-fixture' });
  assert.equal(installManifest.ok, true);
  assert.equal(installManifest.checks.find((check) => check.id === 'runtime_identity_not_root').ok, true);

  const doctor = buildRemoteDoctorPacket({
    installManifest,
    host: 'clawd-exec-hel1',
    user: 'jake',
    node: 'v22.22.2',
    npm: '10.9.7',
    rsync: '/usr/bin/rsync',
    codex: '/home/jake/.local/bin/codex',
    remoteRootExists: true,
    workspaceExists: true,
    publicCortexLinked: true,
    disk: { freeGb: 314, minFreeGb: 20 },
    hostRole: 'execution_plane'
  });
  assert.equal(doctor.status, 'green');

  const blocked = buildRemoteDoctorPacket({ installManifest, user: 'root', node: 'v22.22.2', npm: '10.9.7', rsync: '/usr/bin/rsync', remoteRootExists: true, workspaceExists: true, publicCortexLinked: false, disk: { freeGb: 1, minFreeGb: 20 }, hostRole: 'control_plane' });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.checks.find((check) => check.id === 'least_privilege_runtime_user').ok, false);
  assert.equal(blocked.checks.find((check) => check.id === 'public_cortex_context_linked').ok, false);
  assert.equal(blocked.checks.find((check) => check.id === 'disk_free_above_floor').ok, false);
});

test('Phase 7 heartbeat/log/artifact/disk/budget packet separates observability from terminal truth', () => {
  const green = buildHeartbeatAndArtifactSyncPacket({
    generatedAt: '2026-07-10T17:00:10.000Z',
    heartbeat: { running: true, heartbeatAt: '2026-07-10T17:00:00.000Z' },
    logRotation: { enabled: true, maxBytes: 10_000_000, keep: 5 },
    artifactSync: { enabled: true, lastSyncOk: true, returnPath: '/artifact-return' },
    disk: { alarmEnabled: true, freeGb: 314, minFreeGb: 20 },
    budget: { alarmEnabled: true, used: 10, limit: 100 },
    notifier: { placement: 'control_plane' }
  });
  assert.equal(green.status, 'green');
  assert.match(green.truthBoundary, /does not prove terminal objective truth/);

  const stale = buildHeartbeatAndArtifactSyncPacket({
    generatedAt: '2026-07-10T17:10:00.000Z',
    heartbeat: { running: true, heartbeatAt: '2026-07-10T17:00:00.000Z' },
    logRotation: { enabled: false },
    artifactSync: { enabled: true, lastSyncOk: false, returnPath: '/artifact-return' },
    disk: { alarmEnabled: true, freeGb: 1, minFreeGb: 20 },
    budget: { alarmEnabled: true, used: 200, limit: 100 },
    notifier: { placement: 'heavy_runner' }
  });
  assert.equal(stale.status, 'blocked');
  assert.equal(stale.checks.find((check) => check.id === 'heartbeat_fresh').ok, false);
  assert.equal(stale.checks.find((check) => check.id === 'artifact_sync_configured').ok, false);
});

test('Phase 7 control-plane separation proves stop/drain/cancel/resume boundaries and failure notification semantics', () => {
  const packet = buildControlPlaneSeparationPacket({
    emergencyStop: { available: true, procedure: 'touch STOP' },
    gracefulDrain: { available: true, procedure: 'fence stale workers and stop new leases' },
    cancel: { durableEvent: true },
    resume: { reconcileRemoteBeforeLaunch: true },
    notifierLoss: { truthUnchanged: true, completionCreditGranted: false },
    runnerLoss: { blockerWritable: true, notifierStillAvailable: true }
  });
  assert.equal(packet.status, 'green');

  const unsafe = buildControlPlaneSeparationPacket({
    emergencyStop: { available: false },
    gracefulDrain: { available: true, procedure: 'drain' },
    cancel: { durableEvent: false },
    resume: { reconcileRemoteBeforeLaunch: false },
    notifierLoss: { truthUnchanged: false, completionCreditGranted: true },
    runnerLoss: { blockerWritable: false, notifierStillAvailable: false }
  });
  assert.equal(unsafe.status, 'blocked');
  assert.equal(unsafe.checks.find((check) => check.id === 'notifier_loss_truth_invariant').ok, false);
  assert.equal(unsafe.checks.find((check) => check.id === 'runner_loss_blocker_notification').ok, false);
});

test('Phase 7 path/command/secret malicious fixtures fail closed and redaction removes leaked values', () => {
  assert.equal(evaluatePathPolicy({ paths: ['packages/agent-work-ops/index.mjs'] }).ok, true);
  assert.equal(evaluatePathPolicy({ paths: ['../escape', '/etc/passwd', '.git/config'] }).ok, false);
  assert.equal(evaluateCommandPolicy({ command: 'node', args: ['--version'] }).ok, true);
  assert.equal(evaluateCommandPolicy({ command: 'sh', args: ['-lc', 'rm -rf /'] }).ok, false);
  assert.equal(evaluateCommandPolicy({ command: 'node', args: ['-e', 'process.exit(0); rm -rf /'] }).ok, false);
  const redacted = redactSecrets('OPENAI_API_KEY=sk-testsecret1234567890 Authorization: Bearer abcdefghijklmnopqrstuvwxyz');
  assert.equal(redacted.redacted, true);
  assert.deepEqual(detectSecretLeaks(redacted.text), []);
  const security = buildSecurityReadinessPacket({ allowedPaths: ['packages/agent-work-ops/index.mjs'] });
  assert.equal(security.status, 'green');
  assert.equal(security.checks.find((check) => check.id === 'malicious_commands_fail_closed').ok, true);
});

test('Phase 7 backup/restore readiness works from runtime backup and documented fresh-checkout runbook', () => {
  const runRoot = tmpDir('phase7-runtime-');
  const planned = compileObjective({ input: fixture, outputDir: runRoot });
  assert.equal(planned.ok, true);
  const backup = backupRuntime({ runRoot, backupPath: path.join(runRoot, 'backups/run.db.backup') });
  const packet = buildBackupRestoreReadinessPacket({
    sourceDigest: sha256('phase7-source'),
    backup: { path: backup.backupPath, sha256: backup.sha256 },
    restore: { replayGreen: true, sourceDigest: sha256('phase7-source') },
    runbook: { freshCheckoutProcedure: 'fresh checkout + restore run.db + replay run_events.jsonl', artifactReturnProcedure: 'rsync artifacts back to control plane', requiredArtifacts: ['operations_readiness_packet.json', 'surface_matrix.json'] }
  });
  assert.equal(packet.status, 'green');
  assert.equal(packet.checks.find((check) => check.id === 'backup_exists_and_hashed').ok, true);
});

test('Phase 7 operations readiness packet gates exact operations claims and facade verify/report visibility', () => {
  const inputs = greenPhase7Inputs();
  const packet = buildOperationsReadinessPacket({
    ...inputs,
    runId: 'phase7-fixture',
    remoteQualification: { focusedPass: true, fullPass: true, syncHashMatch: true }
  });
  assert.equal(packet.schemaVersion, AGENT_WORK_PHASE7_OPS_PACKET_SCHEMA);
  assert.equal(packet.status, 'green');
  assert.equal(packet.operationsClaimAllowed, true);
  assert.equal(packet.completionClaimAllowed, false);
  assert.match(packet.truthBoundary, /not release readiness/);

  const blocked = buildOperationsReadinessPacket({
    ...inputs,
    runId: 'phase7-blocked',
    remoteQualification: { focusedPass: true, fullPass: false, syncHashMatch: true }
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.operationsClaimAllowed, false);

  const runRoot = tmpDir('phase7-facade-');
  const planned = compileObjective({ input: fixture, outputDir: runRoot, config: { executionBoundary: 'control_plane_allowed' } });
  assert.equal(planned.ok, true);
  writePhase7OpsArtifacts(packet, path.join(runRoot, 'phase7_ops'));
  const verified = verifyRun({ runRoot });
  assert.equal(verified.data.verification.phase7OpsGreen, true);
  assert.equal(verified.data.verification.operationsClaimAllowed, true);
  const report = buildCompletionPacket({ runRoot });
  assert.equal(report.data.report.schemaVersion, 'clawd.agent_work.phase8_report.v1');
  assert.equal(report.data.report.phase7OpsGreen, true);
  assert.equal(report.data.report.operationsClaimAllowed, true);
});
