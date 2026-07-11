import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const AGENT_WORK_PHASE7_OPS_PACKET_SCHEMA = 'clawd.agent_work.phase7_ops_readiness_packet.v1';
export const AGENT_WORK_PHASE7_INSTALL_MANIFEST_SCHEMA = 'clawd.agent_work.phase7_install_manifest.v1';
export const AGENT_WORK_PHASE7_REMOTE_DOCTOR_SCHEMA = 'clawd.agent_work.phase7_remote_doctor.v1';
export const AGENT_WORK_PHASE7_HEARTBEAT_PACKET_SCHEMA = 'clawd.agent_work.phase7_heartbeat_packet.v1';
export const AGENT_WORK_PHASE7_CONTROL_PACKET_SCHEMA = 'clawd.agent_work.phase7_control_packet.v1';
export const AGENT_WORK_PHASE7_SECURITY_PACKET_SCHEMA = 'clawd.agent_work.phase7_security_packet.v1';
export const AGENT_WORK_PHASE7_BACKUP_PACKET_SCHEMA = 'clawd.agent_work.phase7_backup_restore_packet.v1';

const DEFAULT_ALLOWED_COMMANDS = Object.freeze([
  'cat',
  'cp',
  'date',
  'df',
  'du',
  'find',
  'git',
  'hostname',
  'id',
  'mkdir',
  'node',
  'npm',
  'rsync',
  'sha256sum',
  'tar',
  'test'
]);

const DEFAULT_FORBIDDEN_COMMANDS = Object.freeze([
  'bash',
  'curl',
  'nc',
  'netcat',
  'powershell',
  'rm',
  'scp',
  'sh',
  'ssh',
  'sudo',
  'wget'
]);

const SECRET_PATTERNS = Object.freeze([
  { id: 'openai_key', re: /sk-[A-Za-z0-9_-]{12,}/g, replacement: 'sk-<redacted>' },
  { id: 'bearer_token', re: /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, replacement: 'Bearer <redacted>' },
  { id: 'assignment_secret', re: /\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*['"]?[^\s'",}]{6,}/gi, replacement: '$1=<redacted>' },
  { id: 'private_key_block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: '<redacted-private-key>' }
]);

function nowIso() {
  return new Date().toISOString();
}

function clean(value = '') {
  return String(value ?? '').trim();
}

function stableList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => clean(value))
    .filter(Boolean))];
}

function sha256(value) {
  const payload = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function ageMs(at, generatedAt = nowIso()) {
  const left = Date.parse(generatedAt);
  const right = Date.parse(at || 0);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return left - right;
}

function commandName(command = '') {
  const base = path.basename(clean(command).split(/\s+/)[0] || '');
  return base;
}

export function redactSecrets(value = '') {
  let text = String(value ?? '');
  const redactions = [];
  for (const pattern of SECRET_PATTERNS) {
    const before = text;
    text = text.replace(pattern.re, (...args) => {
      redactions.push(pattern.id);
      if (typeof pattern.replacement === 'string') return pattern.replacement;
      return '<redacted>';
    });
    pattern.re.lastIndex = 0;
    if (before !== text && !redactions.includes(pattern.id)) redactions.push(pattern.id);
  }
  return { text, redactions: [...new Set(redactions)], redacted: redactions.length > 0 };
}

export function detectSecretLeaks(value = '') {
  const text = String(value ?? '');
  const leaks = [];
  for (const pattern of SECRET_PATTERNS) {
    pattern.re.lastIndex = 0;
    if (pattern.re.test(text)) leaks.push(pattern.id);
    pattern.re.lastIndex = 0;
  }
  return leaks;
}

export function evaluatePathPolicy({ paths = [], allowAbsoluteUnder = [], denySegments = ['.git', '.ssh', 'node_modules'], purpose = 'workspace_relative' } = {}) {
  const allowedAbsoluteRoots = stableList(allowAbsoluteUnder).map((entry) => path.resolve(entry));
  const checked = stableList(paths).map((entry) => {
    const normalized = entry.replaceAll('\\', '/');
    const absolute = path.isAbsolute(normalized);
    const segments = normalized.split('/').filter(Boolean);
    const escaped = segments.includes('..') || normalized.includes('\0') || normalized.startsWith('~');
    const deniedSegment = segments.find((segment) => denySegments.includes(segment)) || null;
    const absoluteAllowed = !absolute || allowedAbsoluteRoots.some((root) => path.resolve(normalized).startsWith(`${root}${path.sep}`) || path.resolve(normalized) === root);
    const ok = !escaped && !deniedSegment && absoluteAllowed;
    return {
      path: entry,
      normalized,
      absolute,
      ok,
      failures: [
        escaped ? 'path_escape_or_home_or_null' : null,
        deniedSegment ? `denied_segment:${deniedSegment}` : null,
        absoluteAllowed ? null : 'absolute_path_outside_allowed_roots'
      ].filter(Boolean)
    };
  });
  return {
    ok: checked.every((entry) => entry.ok),
    purpose,
    checked,
    failures: checked.flatMap((entry) => entry.failures.map((failure) => `${entry.path}:${failure}`))
  };
}

export function evaluateCommandPolicy({ command, args = [], allowedCommands = DEFAULT_ALLOWED_COMMANDS, forbiddenCommands = DEFAULT_FORBIDDEN_COMMANDS, allowShell = false } = {}) {
  const name = commandName(command);
  const allTokens = [command, ...stableList(args)].join(' ');
  const shellMetacharacters = /[;&|`$<>]/.test(allTokens) || /\$\(/.test(allTokens);
  const forbidden = forbiddenCommands.includes(name);
  const allowed = allowedCommands.includes(name);
  const shellDenied = !allowShell && ['sh', 'bash', 'zsh', 'fish'].includes(name);
  const ok = Boolean(name) && allowed && !forbidden && !shellDenied && !shellMetacharacters;
  return {
    command,
    args: stableList(args),
    commandName: name,
    ok,
    failures: [
      name ? null : 'missing_command',
      allowed ? null : 'command_not_allowlisted',
      forbidden ? 'command_forbidden' : null,
      shellDenied ? 'shell_denied' : null,
      shellMetacharacters ? 'shell_metacharacters_denied' : null
    ].filter(Boolean)
  };
}

export function buildExecutionPlaneInstallManifest({
  remoteHost = 'jake@37.27.129.239',
  remoteRoot = '/home/jake/clawd-remote',
  qualificationRoot = null,
  runtimeUser = 'jake',
  serviceName = 'agent-work-v1',
  supervisor = 'openclaw-detached-or-systemd',
  healthCommands = [
    { command: 'node', args: ['--version'] },
    { command: 'npm', args: ['--version'] },
    { command: 'rsync', args: ['--version'] },
    { command: 'df', args: ['-h', '/home/jake/clawd-remote'] }
  ],
  notifierPlacement = 'control_plane',
  generatedAt = nowIso()
} = {}) {
  const commandChecks = healthCommands.map((entry) => evaluateCommandPolicy(entry));
  const remoteRootPolicy = evaluatePathPolicy({ paths: [remoteRoot, qualificationRoot].filter(Boolean), allowAbsoluteUnder: ['/home/jake/clawd-remote'], denySegments: ['.git', '.ssh', 'node_modules'], purpose: 'execution_plane_roots' });
  const checks = [
    { id: 'remote_host_declared', ok: Boolean(clean(remoteHost)), detail: clean(remoteHost) || 'missing' },
    { id: 'remote_root_allowed', ok: remoteRootPolicy.ok, detail: remoteRoot },
    { id: 'runtime_identity_not_root', ok: clean(runtimeUser) !== 'root' && Boolean(clean(runtimeUser)), detail: runtimeUser },
    { id: 'service_name_stable', ok: /^[a-z0-9][a-z0-9._-]{2,63}$/i.test(serviceName), detail: serviceName },
    { id: 'supervisor_declared', ok: Boolean(clean(supervisor)), detail: supervisor },
    { id: 'health_commands_allowlisted', ok: commandChecks.every((check) => check.ok), detail: commandChecks.filter((check) => !check.ok).flatMap((check) => check.failures).join(',') || 'ok' },
    { id: 'notifier_outside_heavy_runner', ok: notifierPlacement === 'control_plane' || notifierPlacement === 'external_lightweight', detail: notifierPlacement }
  ];
  return {
    schemaVersion: AGENT_WORK_PHASE7_INSTALL_MANIFEST_SCHEMA,
    generatedAt,
    remoteHost: clean(remoteHost),
    remoteRoot: clean(remoteRoot),
    qualificationRoot: clean(qualificationRoot) || null,
    runtimeUser: clean(runtimeUser),
    serviceName: clean(serviceName),
    supervisor: clean(supervisor),
    notifierPlacement,
    commandChecks,
    pathPolicy: remoteRootPolicy,
    checks,
    ok: checks.every((check) => check.ok),
    truthBoundary: 'The install manifest proves declared execution-plane install intent and local policy checks. It does not prove a live remote host until paired with remote doctor evidence.'
  };
}

export function buildRemoteDoctorPacket({
  installManifest = null,
  host = os.hostname(),
  user = process.env.USER || null,
  node = process.version,
  npm = null,
  rsync = null,
  codex = null,
  remoteRootExists = false,
  workspaceExists = false,
  publicCortexLinked = false,
  disk = {},
  hostRole = 'execution_plane',
  generatedAt = nowIso()
} = {}) {
  const freeGb = Number(disk.freeGb ?? disk.availableGb ?? 0);
  const minFreeGb = Number(disk.minFreeGb ?? 20);
  const checks = [
    { id: 'execution_plane_host_observed', ok: Boolean(clean(host)), detail: clean(host) },
    { id: 'least_privilege_runtime_user', ok: clean(user) && clean(user) !== 'root', detail: clean(user) || 'unknown' },
    { id: 'host_role_execution_plane', ok: hostRole === 'execution_plane', detail: hostRole },
    { id: 'node_available', ok: /^v?2[02]\./.test(clean(node)), detail: clean(node) },
    { id: 'npm_available', ok: Boolean(clean(npm)), detail: clean(npm) || 'missing' },
    { id: 'rsync_available', ok: Boolean(clean(rsync)), detail: clean(rsync) || 'missing' },
    { id: 'codex_path_recorded', ok: Boolean(clean(codex)), detail: clean(codex) || 'missing' },
    { id: 'remote_root_exists', ok: remoteRootExists === true, detail: String(remoteRootExists) },
    { id: 'workspace_exists', ok: workspaceExists === true, detail: String(workspaceExists) },
    { id: 'public_cortex_context_linked', ok: publicCortexLinked === true, detail: String(publicCortexLinked) },
    { id: 'disk_free_above_floor', ok: Number.isFinite(freeGb) && freeGb >= minFreeGb, detail: `${freeGb}GB >= ${minFreeGb}GB` },
    { id: 'install_manifest_green', ok: !installManifest || installManifest.ok === true, detail: installManifest ? String(installManifest.ok) : 'not_supplied' }
  ];
  return {
    schemaVersion: AGENT_WORK_PHASE7_REMOTE_DOCTOR_SCHEMA,
    generatedAt,
    status: checks.every((check) => check.ok) ? 'green' : 'blocked',
    checks,
    hostFacts: { host, user, node, npm, rsync, codex, hostRole },
    disk: { ...disk, freeGb, minFreeGb },
    installManifestDigest: installManifest ? sha256(installManifest) : null,
    truthBoundary: 'Remote doctor proves live execution-plane readiness facts for this qualification root. It does not prove worker correctness or release completion.'
  };
}

export function buildHeartbeatAndArtifactSyncPacket({
  generatedAt = nowIso(),
  heartbeat = {},
  staleAfterMs = 5 * 60_000,
  logRotation = {},
  artifactSync = {},
  disk = {},
  budget = {},
  notifier = {}
} = {}) {
  const heartbeatAgeMs = ageMs(heartbeat.heartbeatAt || heartbeat.generatedAt, generatedAt);
  const diskFreeGb = Number(disk.freeGb ?? disk.availableGb ?? 0);
  const diskMinFreeGb = Number(disk.minFreeGb ?? 20);
  const budgetUsed = Number(budget.used ?? budget.tokensUsed ?? 0);
  const budgetLimit = Number(budget.limit ?? budget.tokenLimit ?? 1);
  const checks = [
    { id: 'heartbeat_fresh', ok: heartbeat.running !== true || (heartbeatAgeMs != null && heartbeatAgeMs >= 0 && heartbeatAgeMs <= staleAfterMs), detail: `ageMs=${heartbeatAgeMs}` },
    { id: 'log_rotation_configured', ok: logRotation.enabled === true && Number(logRotation.maxBytes || 0) > 0 && Number(logRotation.keep || 0) > 0, detail: JSON.stringify(logRotation) },
    { id: 'artifact_sync_configured', ok: artifactSync.enabled === true && artifactSync.lastSyncOk !== false && Boolean(clean(artifactSync.returnPath)), detail: JSON.stringify({ enabled: artifactSync.enabled, lastSyncOk: artifactSync.lastSyncOk, returnPath: artifactSync.returnPath }) },
    { id: 'disk_alarm_configured', ok: disk.alarmEnabled === true && Number.isFinite(diskFreeGb) && diskFreeGb >= diskMinFreeGb, detail: `${diskFreeGb}GB >= ${diskMinFreeGb}GB` },
    { id: 'budget_alarm_configured', ok: budget.alarmEnabled === true && budgetLimit > 0 && budgetUsed <= budgetLimit, detail: `${budgetUsed}/${budgetLimit}` },
    { id: 'notifier_lightweight', ok: notifier.placement === 'control_plane' || notifier.placement === 'external_lightweight', detail: notifier.placement || 'missing' }
  ];
  return {
    schemaVersion: AGENT_WORK_PHASE7_HEARTBEAT_PACKET_SCHEMA,
    generatedAt,
    status: checks.every((check) => check.ok) ? 'green' : 'blocked',
    heartbeat: { ...heartbeat, heartbeatAgeMs, staleAfterMs },
    logRotation,
    artifactSync,
    disk: { ...disk, freeGb: diskFreeGb, minFreeGb: diskMinFreeGb },
    budget: { ...budget, used: budgetUsed, limit: budgetLimit },
    notifier,
    checks,
    truthBoundary: 'Heartbeat and artifact-sync readiness proves observability and alarm configuration. It does not prove terminal objective truth.'
  };
}

export function buildControlPlaneSeparationPacket({
  generatedAt = nowIso(),
  emergencyStop = {},
  gracefulDrain = {},
  cancel = {},
  resume = {},
  notifierLoss = {},
  runnerLoss = {}
} = {}) {
  const checks = [
    { id: 'emergency_stop_declared', ok: emergencyStop.available === true && Boolean(clean(emergencyStop.command || emergencyStop.procedure)), detail: emergencyStop.command || emergencyStop.procedure || 'missing' },
    { id: 'graceful_drain_declared', ok: gracefulDrain.available === true && Boolean(clean(gracefulDrain.procedure || gracefulDrain.command)), detail: gracefulDrain.procedure || gracefulDrain.command || 'missing' },
    { id: 'cancel_records_durable_event', ok: cancel.durableEvent === true, detail: String(cancel.durableEvent) },
    { id: 'resume_reconciles_before_launch', ok: resume.reconcileRemoteBeforeLaunch === true, detail: String(resume.reconcileRemoteBeforeLaunch) },
    { id: 'notifier_loss_truth_invariant', ok: notifierLoss.truthUnchanged === true && notifierLoss.completionCreditGranted !== true, detail: JSON.stringify(notifierLoss) },
    { id: 'runner_loss_blocker_notification', ok: runnerLoss.blockerWritable === true && runnerLoss.notifierStillAvailable === true, detail: JSON.stringify(runnerLoss) }
  ];
  return {
    schemaVersion: AGENT_WORK_PHASE7_CONTROL_PACKET_SCHEMA,
    generatedAt,
    status: checks.every((check) => check.ok) ? 'green' : 'blocked',
    emergencyStop,
    gracefulDrain,
    cancel,
    resume,
    notifierLoss,
    runnerLoss,
    checks,
    truthBoundary: 'Control-plane separation readiness proves stop/drain/cancel/resume procedures and notifier/runner failure boundaries. It does not stop a live process by itself.'
  };
}

export function buildSecurityReadinessPacket({
  generatedAt = nowIso(),
  allowedPaths = [],
  maliciousPaths = ['../escape', '/etc/passwd', '~/.ssh/id_rsa', '.git/config'],
  allowedCommands = [{ command: 'node', args: ['--version'] }, { command: 'rsync', args: ['--version'] }],
  maliciousCommands = [{ command: 'sh', args: ['-lc', 'rm -rf /'] }, { command: 'curl', args: ['https://example.invalid'] }, { command: 'node', args: ['-e', 'process.exit(0); rm -rf /'] }],
  secretSamples = ['OPENAI_API_KEY=sk-testsecret1234567890', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz']
} = {}) {
  const allowedPathPolicy = evaluatePathPolicy({ paths: allowedPaths, purpose: 'allowed_paths' });
  const maliciousPathPolicy = evaluatePathPolicy({ paths: maliciousPaths, purpose: 'malicious_paths' });
  const allowedCommandChecks = allowedCommands.map((entry) => evaluateCommandPolicy(entry));
  const maliciousCommandChecks = maliciousCommands.map((entry) => evaluateCommandPolicy(entry));
  const redactionChecks = secretSamples.map((sample) => {
    const redacted = redactSecrets(sample);
    return { sampleDigest: sha256(sample), redactedText: redacted.text, redactions: redacted.redactions, leaksAfterRedaction: detectSecretLeaks(redacted.text), ok: redacted.redacted && detectSecretLeaks(redacted.text).length === 0 };
  });
  const checks = [
    { id: 'allowed_paths_pass', ok: allowedPathPolicy.ok, detail: allowedPathPolicy.failures.join(',') || 'ok' },
    { id: 'malicious_paths_fail_closed', ok: maliciousPathPolicy.ok === false, detail: maliciousPathPolicy.failures.join(',') || 'unexpected_green' },
    { id: 'allowed_commands_pass', ok: allowedCommandChecks.every((check) => check.ok), detail: allowedCommandChecks.filter((check) => !check.ok).flatMap((check) => check.failures).join(',') || 'ok' },
    { id: 'malicious_commands_fail_closed', ok: maliciousCommandChecks.every((check) => check.ok === false), detail: maliciousCommandChecks.filter((check) => check.ok).map((check) => check.command).join(',') || 'ok' },
    { id: 'secret_redaction_passes', ok: redactionChecks.every((check) => check.ok), detail: redactionChecks.filter((check) => !check.ok).map((check) => check.sampleDigest).join(',') || 'ok' }
  ];
  return {
    schemaVersion: AGENT_WORK_PHASE7_SECURITY_PACKET_SCHEMA,
    generatedAt,
    status: checks.every((check) => check.ok) ? 'green' : 'blocked',
    allowedPathPolicy,
    maliciousPathPolicy,
    allowedCommandChecks,
    maliciousCommandChecks,
    redactionChecks,
    checks,
    truthBoundary: 'Security readiness proves local policy fixtures fail closed and secret samples are redacted. It does not prove absence of all possible secrets in arbitrary future logs.'
  };
}

export function buildBackupRestoreReadinessPacket({
  generatedAt = nowIso(),
  sourceDigest = null,
  backup = {},
  restore = {},
  runbook = {}
} = {}) {
  const backupPath = backup.path || backup.backupPath || null;
  const backupExists = backup.exists === true || (backupPath ? fs.existsSync(backupPath) : false);
  const backupSha = backup.sha256 || (backupPath && fs.existsSync(backupPath) ? sha256(fs.readFileSync(backupPath)) : null);
  const checks = [
    { id: 'source_digest_recorded', ok: /^[a-f0-9]{64}$/.test(clean(sourceDigest || restore.sourceDigest || backup.sourceDigest)), detail: sourceDigest || restore.sourceDigest || backup.sourceDigest || 'missing' },
    { id: 'backup_exists_and_hashed', ok: backupExists && /^[a-f0-9]{64}$/.test(clean(backupSha)), detail: backupPath || 'inline-backup' },
    { id: 'restore_replay_green', ok: restore.replayGreen === true || restore.recovered === true, detail: JSON.stringify(restore) },
    { id: 'fresh_checkout_runbook_present', ok: Boolean(clean(runbook.freshCheckoutProcedure)) && Boolean(clean(runbook.artifactReturnProcedure)), detail: clean(runbook.freshCheckoutProcedure) || 'missing' },
    { id: 'release_artifacts_included', ok: Array.isArray(runbook.requiredArtifacts) && runbook.requiredArtifacts.includes('operations_readiness_packet.json'), detail: (runbook.requiredArtifacts || []).join(',') }
  ];
  return {
    schemaVersion: AGENT_WORK_PHASE7_BACKUP_PACKET_SCHEMA,
    generatedAt,
    status: checks.every((check) => check.ok) ? 'green' : 'blocked',
    sourceDigest: sourceDigest || restore.sourceDigest || backup.sourceDigest || null,
    backup: { ...backup, exists: backupExists, sha256: backupSha },
    restore,
    runbook,
    checks,
    truthBoundary: 'Backup/restore readiness proves the supplied state/artifact backup can be recovered by the documented procedure. It is not a release packet by itself.'
  };
}

export function buildOperationsReadinessPacket({
  generatedAt = nowIso(),
  runId = null,
  installManifest,
  remoteDoctor,
  heartbeatPacket,
  controlPacket,
  securityPacket,
  backupPacket,
  remoteQualification = {},
  allowedClaims = ['Agent Work v1 Phase 7 operations/security/remote-deployment readiness is green for the supplied qualification evidence']
} = {}) {
  const checks = [
    { id: 'clean_execution_plane_install_doctor_green', ok: installManifest?.ok === true && remoteDoctor?.status === 'green', detail: `install=${installManifest?.ok};doctor=${remoteDoctor?.status}` },
    { id: 'heartbeat_log_sync_disk_budget_green', ok: heartbeatPacket?.status === 'green', detail: heartbeatPacket?.status || 'missing' },
    { id: 'emergency_stop_drain_cancel_resume_green', ok: controlPacket?.status === 'green', detail: controlPacket?.status || 'missing' },
    { id: 'notifier_runner_separation_green', ok: controlPacket?.checks?.find((check) => check.id === 'notifier_loss_truth_invariant')?.ok === true && controlPacket?.checks?.find((check) => check.id === 'runner_loss_blocker_notification')?.ok === true, detail: controlPacket?.status || 'missing' },
    { id: 'malicious_path_command_secret_fixtures_fail_closed', ok: securityPacket?.status === 'green', detail: securityPacket?.status || 'missing' },
    { id: 'backup_restore_runbook_green', ok: backupPacket?.status === 'green', detail: backupPacket?.status || 'missing' },
    { id: 'remote_qualification_green', ok: remoteQualification.focusedPass === true && remoteQualification.fullPass === true && remoteQualification.syncHashMatch === true, detail: JSON.stringify(remoteQualification) }
  ];
  const status = checks.every((check) => check.ok) ? 'green' : 'blocked';
  return {
    schemaVersion: AGENT_WORK_PHASE7_OPS_PACKET_SCHEMA,
    generatedAt,
    runId,
    status,
    completionClaimAllowed: false,
    operationsClaimAllowed: status === 'green',
    allowedClaims: status === 'green' ? allowedClaims : [],
    blockedClaims: status === 'green' ? [] : allowedClaims,
    installManifestDigest: installManifest ? sha256(installManifest) : null,
    remoteDoctorDigest: remoteDoctor ? sha256(remoteDoctor) : null,
    heartbeatPacketDigest: heartbeatPacket ? sha256(heartbeatPacket) : null,
    controlPacketDigest: controlPacket ? sha256(controlPacket) : null,
    securityPacketDigest: securityPacket ? sha256(securityPacket) : null,
    backupPacketDigest: backupPacket ? sha256(backupPacket) : null,
    checks,
    remoteQualification,
    truthBoundary: 'Phase 7 proves operations/security/remote-deployment readiness for Agent Work v1. It is not release readiness, 12-worker scale qualification, six-hour soak, full parity, or production deployment.'
  };
}

export function writePhase7OpsArtifacts(packet, outputDir) {
  if (!packet || typeof packet !== 'object') throw new Error('packet is required');
  if (!outputDir) throw new Error('outputDir is required');
  const root = path.resolve(outputDir);
  const packetPath = writeJson(path.join(root, 'operations_readiness_packet.json'), packet);
  const surfaceMatrix = {
    schemaVersion: 'clawd.agent_work.phase7_surface_matrix.v1',
    generatedAt: nowIso(),
    status: packet.status === 'green' ? 'all_complete' : 'blocked',
    surfaces: (packet.checks || []).map((check) => ({ id: check.id, phase: 7, status: check.ok ? 'complete' : 'blocked', proof: packetPath, notes: check.detail })),
    truthBoundary: packet.truthBoundary
  };
  const surfaceMatrixPath = writeJson(path.join(root, 'surface_matrix.json'), surfaceMatrix);
  return { packetPath, surfaceMatrixPath, surfaceMatrix };
}
