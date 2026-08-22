import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const AGENT_WORK_PHASE6_VERIFIER_ADAPTER_SCHEMA = 'clawd.agent_work.phase6_verifier_adapter.v1';
export const AGENT_WORK_PHASE6_VERIFICATION_CONTEXT_SCHEMA = 'clawd.agent_work.phase6_verification_context.v1';
export const AGENT_WORK_PHASE6_VERIFIER_EVIDENCE_SCHEMA = 'clawd.agent_work.phase6_verifier_evidence.v1';
export const AGENT_WORK_PHASE6_VERIFIER_MATRIX_SCHEMA = 'clawd.agent_work.phase6_verifier_matrix.v1';
export const AGENT_WORK_PHASE6_TRUTH_PACKET_SCHEMA = 'clawd.agent_work.phase6_truth_qualification_packet.v1';
export const AGENT_WORK_PHASE6_TERMINAL_BLOCKER_SCHEMA = 'clawd.agent_work.phase6_terminal_blocker.v1';
export const AGENT_WORK_PHASE6_TERMINAL_CLAIM_SCHEMA = 'clawd.agent_work.phase6_terminal_claim.v1';

export const AGENT_WORK_VERIFIER_TYPES = Object.freeze([
  'deterministic_command',
  'schema_static',
  'runtime_integration',
  'browser_visual',
  'manual_review_packet'
]);

const SKIP_DIRS = new Set(['.git', 'node_modules']);

function nowIso() {
  return new Date().toISOString();
}

function clean(value = '') {
  return String(value ?? '').trim();
}

function orderedList(values = []) {
  return (Array.isArray(values) ? values : [values])
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => clean(value))
    .filter(Boolean);
}

function stableList(values = []) {
  return [...new Set(orderedList(values).map((value) => value.replace(/\\/g, '/')))].sort();
}

function normalizeRel(filePath = '') {
  return clean(filePath).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value)
    .filter((key) => !['generatedAt', 'startedAt', 'completedAt', 'evidencePath', 'contextPath', 'packetPath', 'blockerPath', 'claimPath', 'digest', 'evidenceDigest'].includes(key))
    .sort()
    .map((key) => [key, stableValue(value[key])]));
}

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(stableValue(value))).digest('hex');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function safeJoin(root, rel) {
  const resolvedRoot = path.resolve(root);
  const full = path.resolve(resolvedRoot, normalizeRel(rel));
  if (full !== resolvedRoot && !full.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  return full;
}

function readTextIfExists(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? fs.readFileSync(filePath, 'utf8') : null;
}

function walkFiles(root, { prefix = '' } = {}) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, { prefix: rel }));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

function snapshotTree(root, files = null) {
  const rels = files ? stableList(files).filter((rel) => safeJoin(root, rel)) : walkFiles(root);
  const entries = rels.map((rel) => {
    const full = safeJoin(root, rel);
    const text = full ? readTextIfExists(full) : null;
    return {
      path: normalizeRel(rel),
      exists: text !== null,
      sha256: text === null ? null : sha256(text),
      bytes: text === null ? 0 : Buffer.byteLength(text)
    };
  });
  return {
    files: entries,
    digest: sha256(entries.map((entry) => ({ path: entry.path, exists: entry.exists, sha256: entry.sha256 })).sort((a, b) => a.path.localeCompare(b.path)))
  };
}

function copyDir(sourceRoot, targetRoot) {
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const rel of walkFiles(sourceRoot)) {
    const source = safeJoin(sourceRoot, rel);
    const target = safeJoin(targetRoot, rel);
    if (!source || !target) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function patchBundleDigest(patchBundle = {}) {
  return patchBundle.bundleDigest || patchBundle.digest || sha256({
    patchId: patchBundle.patchId,
    modifiedFiles: (patchBundle.modifiedFiles || []).map((entry) => ({ path: entry.path, beforeSha256: entry.beforeSha256 || null, afterSha256: entry.afterSha256 || null }))
  });
}

function applyPatchBundleToContext(contextRoot, patchBundle = {}) {
  for (const file of patchBundle.modifiedFiles || []) {
    const full = safeJoin(contextRoot, file.path);
    if (!full) throw new Error(`unsafe_patch_path:${file.path}`);
    const beforeText = readTextIfExists(full);
    const currentSha = beforeText === null ? null : sha256(beforeText);
    if ((file.beforeSha256 || null) !== (currentSha || null)) throw new Error(`patch_baseline_mismatch:${file.path}`);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (file.afterExists) fs.writeFileSync(full, file.afterContent ?? '');
    else if (fs.existsSync(full)) fs.rmSync(full, { force: true });
  }
}

export function buildVerifierAdapter({
  verifierId,
  type = 'deterministic_command',
  command = null,
  args = [],
  cwd = '.',
  timeoutMs = 120_000,
  outputLimitBytes = 256 * 1024,
  actorRole = 'independent_verifier',
  required = true,
  expectedEvidence = [],
  manualPacket = null,
  generatedAt = nowIso()
} = {}) {
  const normalizedType = clean(type || 'deterministic_command');
  const adapter = {
    schemaVersion: AGENT_WORK_PHASE6_VERIFIER_ADAPTER_SCHEMA,
    generatedAt,
    verifierId: clean(verifierId || `${normalizedType}_verifier`),
    type: normalizedType,
    command: command == null ? null : clean(command),
    args: orderedList(args),
    cwd: normalizeRel(cwd || '.'),
    timeoutMs: Math.max(1000, Number(timeoutMs || 0) || 120_000),
    outputLimitBytes: Math.max(4096, Number(outputLimitBytes || 0) || 256 * 1024),
    actorRole: clean(actorRole || 'independent_verifier'),
    required: required !== false,
    expectedEvidence: stableList(expectedEvidence),
    manualPacket,
    validation: null,
    digest: null,
    truthBoundary: 'A verifier adapter declares an independent evidence collection path. It does not by itself prove acceptance.'
  };
  const knownType = AGENT_WORK_VERIFIER_TYPES.includes(adapter.type);
  const commandRequired = ['manual_review_packet', 'browser_visual'].includes(adapter.type) ? true : Boolean(adapter.command);
  const manualOk = adapter.type !== 'manual_review_packet' || Boolean(adapter.manualPacket);
  const browserOk = adapter.type !== 'browser_visual' || Boolean(adapter.command || adapter.manualPacket);
  adapter.validation = {
    ok: knownType && commandRequired && manualOk && browserOk && adapter.actorRole !== 'worker',
    checks: [
      { id: 'known_verifier_type', ok: knownType },
      { id: 'command_or_packet_available', ok: commandRequired && manualOk && browserOk },
      { id: 'not_worker_self_report', ok: adapter.actorRole !== 'worker' }
    ]
  };
  adapter.digest = sha256(adapter);
  return adapter;
}

export function createVerificationContext({
  sourceRoot,
  patchBundle = null,
  contextRoot,
  verifierId = 'verifier',
  allowedFiles = null,
  generatedAt = nowIso()
} = {}) {
  if (!sourceRoot) throw new Error('sourceRoot is required');
  if (!contextRoot) throw new Error('contextRoot is required');
  const source = path.resolve(sourceRoot);
  const root = path.resolve(contextRoot);
  const workspacePath = path.join(root, 'clean_context', verifierId.replace(/[^a-zA-Z0-9_.-]+/g, '_'));
  fs.rmSync(workspacePath, { recursive: true, force: true });
  copyDir(source, workspacePath);
  const before = snapshotTree(workspacePath, allowedFiles);
  const patchDigest = patchBundle ? patchBundleDigest(patchBundle) : null;
  if (patchBundle) applyPatchBundleToContext(workspacePath, patchBundle);
  const after = snapshotTree(workspacePath, allowedFiles);
  const context = {
    schemaVersion: AGENT_WORK_PHASE6_VERIFICATION_CONTEXT_SCHEMA,
    generatedAt,
    sourceRoot: source,
    workspacePath,
    verifierId,
    allowedFiles: allowedFiles ? stableList(allowedFiles) : null,
    sourceDigest: before.digest,
    patchDigest,
    contextDigest: after.digest,
    sourceFiles: before.files,
    contextFiles: after.files,
    isolated: true,
    digest: null,
    truthBoundary: 'Verification context is a clean copy bound to source and optional patch digests; verifier results outside this context are stale or untrusted.'
  };
  context.digest = sha256(context);
  context.contextPath = writeJson(path.join(workspacePath, 'verification_context.json'), context);
  return context;
}

function manualPacketResult(adapter = {}, context = {}) {
  const packet = adapter.manualPacket || {};
  const boundDigest = packet.boundDigest || packet.contextDigest || packet.patchDigest || packet.sourceDigest || null;
  const expected = context.patchDigest || context.contextDigest || context.sourceDigest;
  const approved = packet.decision === 'approved' || packet.ok === true;
  const independent = packet.nonWorkerReview === true && clean(packet.reviewer || packet.reviewedBy);
  return {
    ok: Boolean(approved && independent && boundDigest === expected),
    stdout: JSON.stringify(packet),
    stderr: '',
    exitCode: approved ? 0 : 1,
    signal: null,
    packet,
    checks: {
      approved,
      independent: Boolean(independent),
      digestBound: boundDigest === expected,
      expectedDigest: expected,
      boundDigest
    }
  };
}

export function runVerifierAdapter({ adapter, context, env = {}, generatedAt = nowIso() } = {}) {
  if (!adapter?.validation?.ok) throw new Error(`invalid_verifier_adapter:${adapter?.verifierId || 'unknown'}`);
  if (!context?.workspacePath) throw new Error('verification context is required');
  const started = Date.now();
  let run;
  if (adapter.type === 'manual_review_packet' || (adapter.type === 'browser_visual' && adapter.manualPacket && !adapter.command)) {
    run = manualPacketResult(adapter, context);
  } else {
    const cwd = safeJoin(context.workspacePath, adapter.cwd || '.') || context.workspacePath;
    const spawned = spawnSync(adapter.command, adapter.args || [], {
      cwd,
      encoding: 'utf8',
      timeout: adapter.timeoutMs,
      shell: false,
      maxBuffer: adapter.outputLimitBytes,
      env: {
        ...process.env,
        ...env,
        AGENT_WORK_VERIFICATION_CONTEXT: context.contextPath || '',
        AGENT_WORK_CONTEXT_DIGEST: context.contextDigest,
        AGENT_WORK_PATCH_DIGEST: context.patchDigest || '',
        AGENT_WORK_SOURCE_DIGEST: context.sourceDigest
      }
    });
    run = { ok: spawned.status === 0 && !spawned.error, stdout: spawned.stdout || '', stderr: spawned.stderr || '', exitCode: spawned.status, signal: spawned.signal || null, error: spawned.error?.message || null };
  }
  const runtimeMs = Math.max(1, Date.now() - started);
  const evidence = {
    schemaVersion: AGENT_WORK_PHASE6_VERIFIER_EVIDENCE_SCHEMA,
    generatedAt,
    completedAt: nowIso(),
    verifierId: adapter.verifierId,
    type: adapter.type,
    actorRole: adapter.actorRole,
    independent: adapter.actorRole !== 'worker',
    command: adapter.command ? [adapter.command, ...(adapter.args || [])].join(' ').trim() : null,
    runtimeMs,
    exitCode: run.exitCode,
    signal: run.signal || null,
    timedOut: run.error === 'ETIMEDOUT' || run.signal === 'SIGTERM',
    ok: run.ok === true,
    skipped: false,
    stdout: String(run.stdout || '').slice(0, adapter.outputLimitBytes),
    stderr: String(run.stderr || '').slice(0, adapter.outputLimitBytes),
    manualPacketChecks: run.checks || null,
    context: {
      contextDigest: context.contextDigest,
      sourceDigest: context.sourceDigest,
      patchDigest: context.patchDigest,
      contextPath: context.contextPath || null,
      workspacePath: context.workspacePath
    },
    evidenceDigest: null,
    truthBoundary: 'Verifier evidence is admissible only when independent, digest-bound to the clean context, and non-stale.'
  };
  evidence.evidenceDigest = sha256(evidence);
  evidence.evidencePath = writeJson(path.join(context.workspacePath, `${adapter.verifierId}_evidence.json`), evidence);
  return evidence;
}

export function validateVerifierEvidence(evidence = {}, { expectedSourceDigest = null, expectedPatchDigest = null, expectedContextDigest = null, requireIndependent = true } = {}) {
  const checks = [
    { id: 'schema_version', ok: evidence.schemaVersion === AGENT_WORK_PHASE6_VERIFIER_EVIDENCE_SCHEMA },
    { id: 'non_skipped_green', ok: evidence.ok === true && evidence.skipped !== true },
    { id: 'independent_not_worker', ok: requireIndependent ? evidence.independent === true && evidence.actorRole !== 'worker' : true },
    { id: 'source_digest_bound', ok: expectedSourceDigest ? evidence.context?.sourceDigest === expectedSourceDigest : Boolean(evidence.context?.sourceDigest) },
    { id: 'patch_digest_bound', ok: expectedPatchDigest ? evidence.context?.patchDigest === expectedPatchDigest : true },
    { id: 'context_digest_bound', ok: expectedContextDigest ? evidence.context?.contextDigest === expectedContextDigest : Boolean(evidence.context?.contextDigest) },
    { id: 'runtime_positive', ok: Number(evidence.runtimeMs || 0) > 0 },
    { id: 'not_timed_out', ok: evidence.timedOut !== true }
  ];
  const recomputed = evidence.evidenceDigest ? sha256(evidence) : null;
  if (evidence.evidenceDigest) checks.push({ id: 'evidence_digest_matches', ok: recomputed === evidence.evidenceDigest });
  return {
    ok: checks.every((check) => check.ok),
    checks,
    recomputedEvidenceDigest: recomputed,
    truthBoundary: 'Verifier evidence validation rejects stale, forged, skipped, worker-authored, or digest-mismatched evidence.'
  };
}

export function buildVerifierMatrix({ verifierResults = [], requiredVerifierIds = [] } = {}) {
  const required = stableList(requiredVerifierIds.length ? requiredVerifierIds : verifierResults.filter((result) => result.required !== false).map((result) => result.verifierId));
  const byId = new Map(verifierResults.map((result) => [result.verifierId, result]));
  const rows = required.map((verifierId) => {
    const result = byId.get(verifierId);
    return {
      verifierId,
      status: result?.ok === true && result?.skipped !== true ? 'green' : 'red',
      evidenceDigest: result?.evidenceDigest || null,
      type: result?.type || null,
      independent: result?.independent === true
    };
  });
  const matrix = {
    schemaVersion: AGENT_WORK_PHASE6_VERIFIER_MATRIX_SCHEMA,
    generatedAt: nowIso(),
    status: rows.length > 0 && rows.every((row) => row.status === 'green' && row.independent === true) ? 'green' : 'red',
    rows,
    summary: {
      requiredCount: rows.length,
      greenCount: rows.filter((row) => row.status === 'green').length,
      redCount: rows.filter((row) => row.status !== 'green').length
    },
    truthBoundary: 'Verifier matrix green means required independent verifier evidence exists. It does not override claim-ledger or objective-truth failures.'
  };
  matrix.digest = sha256(matrix);
  return matrix;
}

function claimLedgerStatus(claimLedger = {}) {
  if (!claimLedger || Object.keys(claimLedger).length === 0) return { status: 'missing', green: false };
  const status = claimLedger.summary?.status || claimLedger.status || 'unknown';
  const green = status === 'green' || claimLedger.summary?.completionEligible === true;
  return { status, green };
}

function objectiveStatus(objectiveTruth = {}) {
  const status = objectiveTruth.status || objectiveTruth.supervisorStatus || (objectiveTruth.ok === true ? 'green' : objectiveTruth.ok === false ? 'red' : 'unknown');
  return { status, green: status === 'green' || objectiveTruth.ok === true };
}

export function buildTerminalBlockerPacket({ runId = 'agent_work_run', code, summary, observedEvidence = [], nextAction, generatedAt = nowIso() } = {}) {
  return {
    schemaVersion: AGENT_WORK_PHASE6_TERMINAL_BLOCKER_SCHEMA,
    generatedAt,
    blockerId: `${runId}:${code || 'phase6_truth_blocked'}:1`,
    runId,
    family: 'completion_truth',
    code: code || 'phase6_truth_blocked',
    summary: summary || 'Agent Work completion truth is blocked by missing or contradictory evidence.',
    observedEvidence: stableList(observedEvidence),
    nextAction: nextAction || 'Fix the failed Phase 6 truth checks and rebuild the terminal packet.',
    retryable: true,
    terminal: true
  };
}

export function buildTerminalClaimPacket({ runId = 'agent_work_run', allowedClaims = [], evidence = {}, generatedAt = nowIso() } = {}) {
  const packet = {
    schemaVersion: AGENT_WORK_PHASE6_TERMINAL_CLAIM_SCHEMA,
    generatedAt,
    runId,
    status: 'green',
    allowedClaims: stableList(allowedClaims),
    evidence,
    completionClaimAllowed: stableList(allowedClaims).length > 0,
    truthBoundary: 'Terminal claim packets allow only exact claims supported by hashed worker, verifier, objective, and claim-ledger evidence.'
  };
  packet.digest = sha256(packet);
  return packet;
}

export function buildCompletionTruthPacket({
  runId = 'agent_work_run',
  workerExecutionPacket = null,
  verifierResults = [],
  verifierMatrix = null,
  claimLedger = {},
  objectiveTruth = {},
  mechanicalGreen = false,
  requestedClaims = ['bounded_verified_worker_progress'],
  generatedAt = nowIso()
} = {}) {
  const matrix = verifierMatrix || buildVerifierMatrix({ verifierResults });
  const claim = claimLedgerStatus(claimLedger);
  const objective = objectiveStatus(objectiveTruth);
  const workerGreen = workerExecutionPacket?.status === 'green' || workerExecutionPacket?.checks?.packetGreen === true;
  const contradictions = [];
  if (matrix.status === 'green' && !claim.green) contradictions.push({ code: 'matrix_green_claim_ledger_red', detail: `claimLedgerStatus=${claim.status}` });
  if (mechanicalGreen === true && !objective.green) contradictions.push({ code: 'mechanical_green_objective_red', detail: `objectiveStatus=${objective.status}` });
  const checks = {
    workerExecutionGreen: workerGreen,
    verifierMatrixGreen: matrix.status === 'green',
    claimLedgerGreen: claim.green,
    objectiveTruthGreen: objective.green,
    noContradictions: contradictions.length === 0,
    hashedEvidencePresent: Boolean(workerExecutionPacket?.schemaVersion) && Boolean(matrix.digest) && Boolean(claimLedger?.summary || claimLedger?.status) && Boolean(objectiveTruth?.status || objectiveTruth?.ok !== undefined)
  };
  const green = Object.values(checks).every(Boolean);
  const blocker = green ? null : buildTerminalBlockerPacket({
    runId,
    code: contradictions[0]?.code || 'phase6_completion_truth_not_green',
    summary: contradictions.length
      ? 'Phase 6 detected a contradiction between verifier/mechanical green and claim/objective truth.'
      : 'Phase 6 completion truth is missing required worker, verifier, claim-ledger, objective, or hashed evidence.',
    observedEvidence: [
      `workerExecutionGreen=${checks.workerExecutionGreen}`,
      `verifierMatrix=${matrix.status}`,
      `claimLedger=${claim.status}`,
      `objectiveTruth=${objective.status}`,
      `contradictions=${contradictions.map((entry) => entry.code).join(',') || 'none'}`
    ],
    nextAction: contradictions.length ? 'Resolve the contradiction before allowing completion claims.' : 'Complete missing Phase 6 evidence and rebuild the truth packet.'
  });
  const terminalClaim = green ? buildTerminalClaimPacket({
    runId,
    allowedClaims: requestedClaims,
    evidence: {
      workerExecutionPacketDigest: workerExecutionPacket?.digest || workerExecutionPacket?.bundleDigest || workerExecutionPacket?.schemaVersion || null,
      verifierMatrixDigest: matrix.digest,
      claimLedgerStatus: claim.status,
      objectiveTruthStatus: objective.status
    },
    generatedAt
  }) : null;
  const packet = {
    schemaVersion: AGENT_WORK_PHASE6_TRUTH_PACKET_SCHEMA,
    generatedAt,
    runId,
    status: green ? 'green' : 'blocked',
    completionClaimAllowed: green,
    allowedClaims: green ? terminalClaim.allowedClaims : [],
    checks,
    contradictions,
    workerExecutionPacketStatus: workerExecutionPacket?.status || null,
    verifierMatrix: matrix,
    claimLedgerSummary: claimLedger?.summary || claimLedger || null,
    objectiveTruth,
    mechanicalGreen: mechanicalGreen === true,
    terminalClaim,
    blocker,
    truthBoundary: green
      ? 'Phase 6 green proves bounded completion truth for the supplied worker/verifier/claim/objective evidence. It is not a release or scale-tier claim.'
      : 'Phase 6 blocked means no completion claim can be made, even if lower-level mechanics are green.'
  };
  packet.digest = sha256(packet);
  return packet;
}

export function writePhase6TruthArtifacts(packet, artifactRoot) {
  const root = path.resolve(artifactRoot || '.');
  fs.mkdirSync(root, { recursive: true });
  const paths = {
    truthQualificationPacket: writeJson(path.join(root, 'truth_qualification_packet.json'), packet),
    verifierMatrix: writeJson(path.join(root, 'verifier_matrix.json'), packet.verifierMatrix),
    terminalClaim: packet.terminalClaim ? writeJson(path.join(root, 'terminal_claim_packet.json'), packet.terminalClaim) : null,
    terminalBlocker: packet.blocker ? writeJson(path.join(root, 'terminal_blocker_packet.json'), packet.blocker) : null
  };
  return paths;
}
