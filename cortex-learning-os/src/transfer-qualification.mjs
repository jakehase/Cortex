import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { routeCodingTransfer } from '../../plugins/cortex-learning-os-live/transfer.mjs';
import { sha256File, sha256Text } from './hash.mjs';
import { replayTransferOracle, transferTaskSetDigest } from './transfer-tasks.mjs';

export const TRANSFER_PLAN_SCHEMA = 'cortex.learning_os.transfer_qualification_plan.v1';
export const TRANSFER_REPORT_SCHEMA = 'cortex.learning_os.transfer_promotion_report.v1';
const PLAN_KEYS = new Set([
  'schemaVersion', 'runId', 'generatedAt', 'sourceCommit', 'profileId', 'frozenDigests',
  'runtime', 'budgets', 'evidenceRequirements', 'gates', 'taskIds', 'arms', 'trialOrder', 'terminalOutcomes',
  'truthBoundary', 'controlPlaneSignature',
]);
const DIGEST = /^[0-9a-f]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const RUNTIME_KEYS = new Set(['schemaVersion', 'provider', 'runner', 'model', 'reasoningEffort', 'sandbox', 'toolsAllowed']);
export const DEFAULT_TRANSFER_RUNTIME = Object.freeze({
  schemaVersion: 'cortex.learning_os.transfer_runtime.v1',
  provider: 'openai-codex',
  runner: 'codex-exec-ephemeral',
  model: 'gpt-5.6-sol',
  reasoningEffort: 'xhigh',
  sandbox: 'read-only',
  toolsAllowed: false,
});

export function validateTransferRuntime(runtime) {
  const errors = [];
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)
      || Object.keys(runtime).length !== RUNTIME_KEYS.size
      || Object.keys(runtime).some((key) => !RUNTIME_KEYS.has(key))) return { ok: false, errors: ['invalid transfer runtime shape'] };
  if (runtime.schemaVersion !== 'cortex.learning_os.transfer_runtime.v1') errors.push('invalid transfer runtime schema');
  for (const field of ['provider', 'runner', 'model']) {
    if (typeof runtime[field] !== 'string' || !runtime[field] || runtime[field].length > 128) errors.push(`invalid transfer runtime ${field}`);
  }
  if (!['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(runtime.reasoningEffort)) errors.push('invalid transfer runtime reasoning effort');
  if (runtime.sandbox !== 'read-only' || runtime.toolsAllowed !== false) errors.push('transfer qualification runtime must be read-only and tool-free');
  return { ok: errors.length === 0, errors };
}

export function buildTransferTrialOrder(runId, tasks) {
  return [...tasks]
    .sort((left, right) => sha256Text(`${runId}:${left.taskId}`).localeCompare(sha256Text(`${runId}:${right.taskId}`)))
    .flatMap((task, index) => (index % 2 === 0 ? ['candidate', 'no-transfer'] : ['no-transfer', 'candidate'])
      .map((arm) => ({ taskId: task.taskId, arm })));
}

function unsignedPlan(plan) {
  const { controlPlaneSignature: _signature, ...payload } = plan;
  return payload;
}

function planDigest(plan) {
  return sha256Text(canonicalJson(plan));
}

export function buildTransferQualificationPlan({
  runId,
  profile,
  policy,
  tasks,
  sourceCommit,
  signingSecret,
  runtime = DEFAULT_TRANSFER_RUNTIME,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!RUN_ID.test(String(runId || '')) || sourceCommit !== profile.source.baseCommit) throw new Error('invalid qualification run/source binding');
  const runtimeValidation = validateTransferRuntime(runtime);
  if (!runtimeValidation.ok) throw new Error(`invalid qualification runtime: ${runtimeValidation.errors.join('; ')}`);
  if (tasks.length > policy.budgets.maxTasks) throw new Error('transfer task budget exceeded');
  const payload = {
    schemaVersion: TRANSFER_PLAN_SCHEMA,
    runId,
    generatedAt,
    sourceCommit,
    profileId: profile.profileId,
    runtime: structuredClone(runtime),
    frozenDigests: {
      profile: profile.source.profileDigest,
      policy: sha256Text(canonicalJson(policy)),
      source: profile.source.sourceDigest,
      tasks: transferTaskSetDigest(tasks),
    },
    budgets: structuredClone(policy.budgets),
    evidenceRequirements: structuredClone(policy.evidenceRequirements),
    gates: structuredClone(policy.gates),
    taskIds: tasks.map((task) => task.taskId),
    arms: ['candidate', 'no-transfer'],
    trialOrder: buildTransferTrialOrder(runId, tasks),
    terminalOutcomes: ['qualified', 'candidate', 'no-transfer', 'invalid', 'blocked', 'underpowered', 'null'],
    truthBoundary: 'A signed plan freezes finite deterministic qualification inputs. It is not a run, result, qualification, activation, or empirical benefit claim.',
  };
  return {
    ...payload,
    controlPlaneSignature: {
      algorithm: 'hmac-sha256',
      keyId: sha256Text(signingSecret).slice(0, 16),
      digest: crypto.createHmac('sha256', signingSecret).update(canonicalJson(payload)).digest('hex'),
    },
  };
}

export function verifyTransferQualificationPlan(plan, { profile, policy, tasks, signingSecret } = {}) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || Object.keys(plan).some((key) => !PLAN_KEYS.has(key))) return { ok: false, errors: ['invalid transfer plan shape'] };
  if (plan.schemaVersion !== TRANSFER_PLAN_SCHEMA || !RUN_ID.test(String(plan.runId || ''))) errors.push('invalid transfer plan identity');
  const runtimeValidation = validateTransferRuntime(plan.runtime);
  if (!runtimeValidation.ok) errors.push(...runtimeValidation.errors);
  if (plan.profileId !== profile.profileId || plan.sourceCommit !== profile.source.baseCommit) errors.push('transfer plan profile/source mismatch');
  const expectedFrozen = {
    profile: profile.source.profileDigest,
    policy: sha256Text(canonicalJson(policy)),
    source: profile.source.sourceDigest,
    tasks: transferTaskSetDigest(tasks),
  };
  if (canonicalJson(plan.frozenDigests) !== canonicalJson(expectedFrozen)
      || canonicalJson(plan.budgets) !== canonicalJson(policy.budgets)
      || canonicalJson(plan.evidenceRequirements) !== canonicalJson(policy.evidenceRequirements)
      || canonicalJson(plan.gates) !== canonicalJson(policy.gates)
      || canonicalJson(plan.taskIds) !== canonicalJson(tasks.map((task) => task.taskId))
      || canonicalJson(plan.trialOrder) !== canonicalJson(buildTransferTrialOrder(plan.runId, tasks))) errors.push('transfer plan frozen inputs mismatch');
  const signature = plan.controlPlaneSignature;
  if (signature?.algorithm !== 'hmac-sha256' || signature.keyId !== sha256Text(signingSecret).slice(0, 16)
      || !DIGEST.test(String(signature?.digest || ''))) errors.push('invalid transfer plan signature');
  else {
    const expected = crypto.createHmac('sha256', signingSecret).update(canonicalJson(unsignedPlan(plan))).digest();
    const actual = Buffer.from(signature.digest, 'hex');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) errors.push('transfer plan signature mismatch');
  }
  return { ok: errors.length === 0, errors };
}

function safeArtifactPath(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)
      || relative.split(/[\\/]+/).some((part) => !part || part === '.' || part === '..')) throw new Error(`unsafe transfer artifact path: ${relative}`);
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`transfer artifact escaped root: ${relative}`);
  return resolved;
}

function listArtifactFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`transfer artifact symlink rejected: ${entry.name}`);
    if (entry.isDirectory()) files.push(...listArtifactFiles(target));
    else if (entry.isFile()) files.push(target);
    else throw new Error(`unsupported transfer artifact node: ${entry.name}`);
  }
  return files;
}

export function verifyTransferArtifactManifest(artifactRoot, policy) {
  const root = path.resolve(artifactRoot);
  const manifestPath = path.join(root, 'artifact_manifest.json');
  const manifestStat = fs.lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error('transfer artifact manifest must be a regular file');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const keys = new Set(['schemaVersion', 'runId', 'generatedAt', 'files', 'truthBoundary']);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || Object.keys(manifest).some((key) => !keys.has(key))
      || manifest.schemaVersion !== 'cortex.learning_os.transfer_artifact_manifest.v1'
      || !RUN_ID.test(String(manifest.runId || '')) || !Number.isFinite(Date.parse(String(manifest.generatedAt || '')))
      || !Array.isArray(manifest.files) || manifest.files.length < 4 || manifest.files.length > policy.budgets.maxArtifactFiles) throw new Error('invalid transfer artifact manifest');
  let bytes = manifestStat.size;
  const seen = new Set();
  for (const row of manifest.files) {
    if (!row || Object.keys(row).some((key) => !['path', 'sha256', 'bytes'].includes(key))
        || !DIGEST.test(String(row.sha256 || '')) || !Number.isSafeInteger(row.bytes) || row.bytes < 0
        || seen.has(row.path) || row.path === 'artifact_manifest.json') throw new Error('invalid transfer artifact manifest row');
    const target = safeArtifactPath(root, row.path);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== row.bytes || sha256File(target) !== row.sha256) throw new Error(`transfer artifact mutation: ${row.path}`);
    seen.add(row.path);
    bytes += row.bytes;
  }
  const actual = listArtifactFiles(root)
    .map((filePath) => path.relative(root, filePath))
    .filter((relative) => relative !== 'artifact_manifest.json')
    .sort();
  if (canonicalJson(actual) !== canonicalJson([...seen].sort())) throw new Error('transfer manifest does not exactly cover artifact files');
  if (bytes > policy.budgets.maxArtifactBytes) throw new Error('transfer artifact byte budget exceeded');
  return { manifest, artifactManifestDigest: sha256File(manifestPath) };
}

function rate(rows) {
  return rows.length ? rows.filter((row) => row.oracle.passed).length / rows.length : 0;
}

function validateAttemptShape(attempt) {
  const keys = new Set([
    'schemaVersion', 'attemptId', 'runId', 'profileId', 'taskId', 'taskDigest',
    'family', 'arm', 'valid', 'validityReasonCode', 'semanticDecision', 'oracle',
    'result', 'startedAt', 'completedAt', 'evidenceDigest',
  ]);
  return attempt && typeof attempt === 'object' && !Array.isArray(attempt)
    && Object.keys(attempt).every((key) => keys.has(key))
    && attempt.schemaVersion === 'cortex.learning_os.transfer_attempt.v1'
    && RUN_ID.test(String(attempt.attemptId || '')) && RUN_ID.test(String(attempt.runId || ''))
    && ['candidate', 'no-transfer'].includes(attempt.arm) && typeof attempt.result === 'string' && attempt.result.length <= 8192;
}

function replayAttempts({ attempts, tasks, plan }) {
  const taskById = new Map(tasks.map((task) => [task.taskId, task]));
  const seen = new Set();
  const seenAttemptIds = new Set();
  const replayed = [];
  for (const attempt of attempts) {
    const task = taskById.get(attempt?.taskId);
    const key = `${attempt?.taskId}:${attempt?.arm}`;
    const shapeValid = validateAttemptShape(attempt);
    const valid = shapeValid && !seen.has(key) && !seenAttemptIds.has(attempt?.attemptId) && Boolean(task)
      && attempt.runId === plan.runId && attempt.profileId === plan.profileId
      && attempt.taskDigest === task.taskDigest && attempt.family === task.family
      && Number.isFinite(Date.parse(String(attempt.startedAt || '')))
      && Number.isFinite(Date.parse(String(attempt.completedAt || '')))
      && Date.parse(attempt.completedAt) >= Date.parse(attempt.startedAt);
    seen.add(key);
    seenAttemptIds.add(attempt?.attemptId);
    const route = task ? routeCodingTransfer(task.prompt, { allowedProfileIds: [plan.profileId], selectionMode: 'qualification-replay' }) : null;
    const selection = route?.evaluations.find((row) => row.profileId === plan.profileId);
    const semanticDecision = {
      applicable: Boolean(selection?.applicable),
      reasonCodes: selection?.applicabilityReasonCodes || route?.reasonCodes || ['invalid-task'],
      observedAssumptionCodes: selection?.observedAssumptionCodes || [],
      negativeGateCodes: selection?.negativeGateCodes || [],
    };
    const oracle = task ? replayTransferOracle(task, attempt?.result || '') : {
      oracleId: 'semantic-route-v1',
      executed: false,
      passed: false,
      resultDigest: sha256Text('invalid-task'),
    };
    const payload = {
      ...attempt,
      valid,
      validityReasonCode: valid ? 'valid-replayed-trial' : 'invalid-trial-binding',
      semanticDecision,
      oracle,
    };
    delete payload.evidenceDigest;
    replayed.push({ ...payload, evidenceDigest: sha256Text(canonicalJson(payload)) });
  }
  return replayed;
}

function verifyProviderCalls(artifactRoot, attempts, plan) {
  const ledgerPath = path.join(artifactRoot, 'provider_calls.json');
  if (!fs.existsSync(ledgerPath)) return { present: false, valid: false, calls: 0 };
  const calls = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const callKeys = new Set([
    'callId', 'taskId', 'arm', 'provider', 'model', 'commandIdentity', 'startedAt',
    'completedAt', 'runtimeMs', 'exitStatus', 'usage', 'runtimeContractDigest',
  ]);
  const commandKeys = new Set(['executable', 'argvDigest']);
  const usageKeys = new Set(['input_tokens', 'output_tokens', 'cached_input_tokens', 'total_tokens']);
  if (!Array.isArray(calls) || calls.length !== attempts.length || Buffer.byteLength(JSON.stringify(calls)) > 256 * 1024) {
    throw new Error('invalid provider call ledger');
  }
  const seen = new Set();
  const seenCallIds = new Set();
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    const attempt = attempts[index];
    const key = `${call?.taskId}:${call?.arm}`;
    const usageValid = call?.usage && typeof call.usage === 'object' && !Array.isArray(call.usage)
      && Object.keys(call.usage).every((name) => usageKeys.has(name))
      && Object.values(call.usage).every((value) => Number.isSafeInteger(value) && value >= 0)
      && Number.isSafeInteger(call.usage.input_tokens) && call.usage.input_tokens > 0
      && Number.isSafeInteger(call.usage.output_tokens) && call.usage.output_tokens > 0;
    if (!call || typeof call !== 'object' || Array.isArray(call)
        || Object.keys(call).length !== callKeys.size || Object.keys(call).some((name) => !callKeys.has(name))
        || seen.has(key) || seenCallIds.has(call.callId) || call.callId !== attempt?.attemptId || call.taskId !== attempt?.taskId
        || call.arm !== attempt?.arm || call.provider !== plan.runtime.provider || call.model !== plan.runtime.model
        || call.runtimeContractDigest !== sha256Text(canonicalJson(plan.runtime))
        || !call.commandIdentity || Object.keys(call.commandIdentity).length !== commandKeys.size
        || Object.keys(call.commandIdentity).some((name) => !commandKeys.has(name))
        || typeof call.commandIdentity.executable !== 'string' || !call.commandIdentity.executable
        || plan.runtime.runner === 'codex-exec-ephemeral' && call.commandIdentity.executable !== 'codex'
        || !DIGEST.test(String(call.commandIdentity.argvDigest || ''))
        || call.startedAt !== attempt?.startedAt || call.completedAt !== attempt?.completedAt
        || !Number.isFinite(Date.parse(call.startedAt)) || Date.parse(call.completedAt) <= Date.parse(call.startedAt)
        || !Number.isSafeInteger(call.runtimeMs) || call.runtimeMs <= 0 || call.exitStatus !== 0 || !usageValid) {
      throw new Error('invalid provider call ledger row');
    }
    seen.add(key);
    seenCallIds.add(call.callId);
  }
  return { present: true, valid: true, calls: calls.length };
}

export function replayTransferQualification({ artifactRoot, profile, policy, tasks, signingSecret, evaluatedAt = null } = {}) {
  const { manifest, artifactManifestDigest } = verifyTransferArtifactManifest(artifactRoot, policy);
  const plan = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'plan.json'), 'utf8'));
  const planVerification = verifyTransferQualificationPlan(plan, { profile, policy, tasks, signingSecret });
  if (!planVerification.ok) throw new Error(`transfer plan verification failed: ${planVerification.errors.join('; ')}`);
  if (manifest.runId !== plan.runId) throw new Error('transfer manifest run mismatch');
  const storedTasks = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'tasks.json'), 'utf8'));
  if (canonicalJson(storedTasks) !== canonicalJson(tasks)) throw new Error('transfer task replay mismatch');
  const proposal = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'worker_proposal.json'), 'utf8'));
  const proposalKeys = new Set(['schemaVersion', 'runId', 'profileId', 'planDigest', 'completedAt', 'terminalStatus', 'attemptsDigest', 'claimedOutcome', 'truthBoundary']);
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal) || Object.keys(proposal).some((key) => !proposalKeys.has(key))
      || proposal.schemaVersion !== 'cortex.learning_os.transfer_worker_proposal.v1'
      || proposal.runId !== plan.runId || proposal.profileId !== profile.profileId
      || proposal.planDigest !== planDigest(plan)
      || !['completed', 'blocked'].includes(proposal.terminalStatus)) throw new Error('invalid inert worker proposal');
  const reportTimestamp = evaluatedAt || proposal.completedAt;
  if (!Number.isFinite(Date.parse(String(reportTimestamp || '')))) throw new Error('invalid transfer evaluation timestamp');
  const storedAttempts = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'attempts.json'), 'utf8'));
  if (!Array.isArray(storedAttempts) || storedAttempts.length > policy.budgets.maxTrials
      || proposal.attemptsDigest !== sha256Text(canonicalJson(storedAttempts))) throw new Error('transfer attempt proposal mismatch');
  const providerEvidence = verifyProviderCalls(artifactRoot, storedAttempts, plan);
  const attempts = replayAttempts({ attempts: storedAttempts, tasks, plan });
  const valid = attempts.filter((row) => row.valid);
  const invalid = attempts.filter((row) => !row.valid);
  const candidate = valid.filter((row) => row.arm === 'candidate');
  const noTransfer = valid.filter((row) => row.arm === 'no-transfer');
  const heldOut = candidate.filter((row) => row.family === 'held-out');
  const negative = candidate.filter((row) => row.family === 'negative-semantic');
  const violations = candidate.filter((row) => row.family === 'assumption-violation');
  const regression = candidate.filter((row) => row.family === 'regression');
  const metrics = {
    candidateAccuracy: rate(candidate),
    noTransferAccuracy: rate(noTransfer),
    accuracyLift: rate(candidate) - rate(noTransfer),
    negativeSemanticAccuracy: rate(negative),
    assumptionViolationAccuracy: rate(violations),
    regressionAccuracy: rate(regression),
  };
  const requirements = policy.evidenceRequirements;
  const gates = {
    providerEvidence: providerEvidence.valid,
    powered: candidate.length >= requirements.minimumValidCandidateTrials
      && noTransfer.length >= requirements.minimumValidNoTransferTrials
      && heldOut.length >= requirements.minimumHeldOutTasks
      && negative.length >= requirements.minimumNegativeSemanticTasks
      && violations.length >= requirements.minimumAssumptionViolationTasks
      && regression.length >= requirements.minimumRegressionTasks,
    validTrials: invalid.length / Math.max(1, attempts.length) <= policy.gates.maximumInvalidTrialFraction,
    candidateAccuracy: metrics.candidateAccuracy >= policy.gates.minimumCandidateAccuracy
      && metrics.noTransferAccuracy >= policy.gates.minimumNoTransferAccuracy,
    lift: metrics.accuracyLift >= policy.gates.minimumAccuracyLift,
    negativeSemantic: metrics.negativeSemanticAccuracy >= policy.gates.minimumNegativeSemanticAccuracy,
    assumptionViolation: metrics.assumptionViolationAccuracy >= policy.gates.minimumAssumptionViolationAccuracy,
    noRegression: metrics.regressionAccuracy >= policy.gates.minimumRegressionAccuracy,
    exactOracles: !policy.gates.requireAllExactOracles || candidate
      .filter((row) => ['exact-integer-product-v1', 'integer-polynomial-identity-v1'].includes(row.oracle.oracleId))
      .every((row) => row.oracle.executed && row.oracle.passed),
  };
  let outcome = 'candidate';
  if (proposal.terminalStatus === 'blocked') outcome = 'blocked';
  else if (!gates.providerEvidence) outcome = 'invalid';
  else if (!gates.validTrials) outcome = 'invalid';
  else if (!gates.powered) outcome = 'underpowered';
  else if (Object.values(gates).every(Boolean)) outcome = 'qualified';
  else if (!gates.lift && metrics.candidateAccuracy <= metrics.noTransferAccuracy) outcome = 'null';
  else if (!gates.negativeSemantic || !gates.assumptionViolation || !gates.noRegression || !gates.exactOracles) outcome = 'no-transfer';
  const reasons = {};
  for (const attempt of attempts) {
    for (const reason of attempt.semanticDecision.reasonCodes) reasons[reason] = Number(reasons[reason] || 0) + 1;
  }
  return {
    schemaVersion: TRANSFER_REPORT_SCHEMA,
    runId: plan.runId,
    profileId: profile.profileId,
    evaluatedAt: reportTimestamp,
    outcome,
    artifactManifestDigest,
    frozenDigests: { ...plan.frozenDigests, plan: planDigest(plan) },
    counts: {
      total: attempts.length,
      valid: valid.length,
      invalid: invalid.length,
      candidate: candidate.length,
      noTransfer: noTransfer.length,
      heldOut: heldOut.length,
      negativeSemantic: negative.length,
      assumptionViolation: violations.length,
      regression: regression.length,
    },
    metrics,
    gates,
    applicabilityReasonCounts: Object.entries(reasons)
      .map(([reasonCode, count]) => ({ reasonCode, count }))
      .sort((left, right) => left.reasonCode.localeCompare(right.reasonCode)),
    evidenceDigest: sha256Text(canonicalJson(attempts)),
    truthBoundary: 'This independently replayed deterministic report qualifies only the exact profile/artifacts when every gate passes. It is not mathematical mastery, broad coding capability, or evidence of live empirical benefit.',
  };
}
