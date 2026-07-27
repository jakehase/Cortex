import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { validateCurriculumGraph } from './curriculum-planner.mjs';
import { isContinuousAcquisitionPolicy, policyDigest } from './adaptive-policy.mjs';

export const LEGACY_MASTERY_SCHEMA = 'cortex.learning_os.mastery_state.v1';
export const MASTERY_SCHEMA = 'cortex.learning_os.mastery_state.v2';
export const MASTERY_SIGNATURE_ALGORITHM = 'hmac-sha256';
const LEGACY_STATES = new Set(['unassessed', 'learning', 'review', 'mastered', 'lapsed', 'blocked_prerequisite']);
const CONTINUOUS_STATES = new Set(['unassessed', 'learning', 'acquired', 'blocked_prerequisite']);
const LEGACY_ROLES = new Set(['acquisition', 'correction', 'promotion-transfer', 'held-out', 'spaced-review']);
const CONTINUOUS_ROLES = new Set(['acquisition', 'correction']);

function unsigned(state) {
  const { signature: _signature, ...value } = state;
  return value;
}

function keyId(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 16);
}

export function defaultContinuousConcept() {
  return {
    state: 'unassessed',
    attempts: 0,
    passes: 0,
    failures: 0,
    consecutivePasses: 0,
    consecutiveFailures: 0,
    historicalReviewStage: 0,
    lastAttemptedAt: null,
    lastReviewedAt: null,
    historicalNextReviewAt: null,
    nextReviewAt: null,
    acquiredAt: null,
    lastEvidenceDigest: null,
    lastRunId: null,
  };
}

function defaultLegacyConcept() {
  const record = defaultContinuousConcept();
  const {
    historicalReviewStage: _historicalReviewStage,
    historicalNextReviewAt: _historicalNextReviewAt,
    acquiredAt: _acquiredAt,
    ...legacy
  } = record;
  return { ...legacy, reviewStage: 0 };
}

export function createMasteryState({ graph, policy, now = new Date().toISOString() } = {}) {
  const validation = validateCurriculumGraph(graph);
  if (!validation.ok) throw new Error(`invalid curriculum graph: ${validation.errors.join('; ')}`);
  const continuous = isContinuousAcquisitionPolicy(policy);
  return {
    schemaVersion: continuous ? MASTERY_SCHEMA : LEGACY_MASTERY_SCHEMA,
    revision: 0,
    curriculumId: graph.curriculumId,
    capsuleId: graph.capsuleId,
    policyDigest: policyDigest(policy),
    updatedAt: now,
    concepts: Object.fromEntries(validation.topologicalOrder.map((id) => [
      id,
      continuous ? defaultContinuousConcept() : defaultLegacyConcept(),
    ])),
    pendingRepairs: [],
    appliedRunIds: [],
    appliedRunReceipts: [],
    ...(continuous ? { migration: null } : {}),
  };
}

export function signMasteryState(state, secret) {
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 4096) throw new Error('mastery HMAC secret is missing or invalid');
  const payload = unsigned(state);
  return {
    ...payload,
    signature: {
      algorithm: MASTERY_SIGNATURE_ALGORITHM,
      keyId: keyId(secret),
      digest: crypto.createHmac('sha256', secret).update(canonicalJson(payload)).digest('hex'),
    },
  };
}

export function validateMasteryState(state, { graph, policy } = {}) {
  const errors = [];
  if (!state || typeof state !== 'object' || Array.isArray(state)) return { ok: false, errors: ['mastery state must be an object'] };
  const continuous = isContinuousAcquisitionPolicy(policy);
  const expectedSchema = continuous ? MASTERY_SCHEMA : LEGACY_MASTERY_SCHEMA;
  if (state.schemaVersion !== expectedSchema) errors.push('invalid mastery schemaVersion for policy');
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) errors.push('invalid revision');
  if (state.curriculumId !== graph?.curriculumId || state.capsuleId !== graph?.capsuleId) errors.push('mastery scope mismatch');
  if (state.policyDigest !== policyDigest(policy)) errors.push('mastery policy drift');
  if (!Number.isFinite(Date.parse(String(state.updatedAt || '')))) errors.push('invalid updatedAt');
  const ids = new Set((graph?.concepts || []).map((concept) => concept.conceptId));
  if (!state.concepts || typeof state.concepts !== 'object' || Array.isArray(state.concepts)
      || Object.keys(state.concepts).length !== ids.size || Object.keys(state.concepts).some((id) => !ids.has(id))) errors.push('mastery concept set mismatch');
  for (const [id, record] of Object.entries(state.concepts || {})) {
    const states = continuous ? CONTINUOUS_STATES : LEGACY_STATES;
    if (!record || !states.has(record.state)) errors.push(`invalid state: ${id}`);
    const integerFields = [
      'attempts', 'passes', 'failures', 'consecutivePasses', 'consecutiveFailures',
      continuous ? 'historicalReviewStage' : 'reviewStage',
    ];
    for (const field of integerFields) {
      if (!Number.isSafeInteger(record?.[field]) || record[field] < 0) errors.push(`invalid ${id}.${field}`);
    }
    if (record && record.attempts !== record.passes + record.failures) errors.push(`attempt count mismatch: ${id}`);
    if (!continuous && record && record.reviewStage >= policy.spacingDays.length) errors.push(`review stage outside policy: ${id}`);
    const timestampFields = continuous
      ? ['lastAttemptedAt', 'lastReviewedAt', 'historicalNextReviewAt', 'nextReviewAt']
      : ['lastAttemptedAt', 'lastReviewedAt', 'nextReviewAt'];
    for (const field of timestampFields) {
      if (record?.[field] !== null && !Number.isFinite(Date.parse(String(record?.[field] || '')))) errors.push(`invalid ${id}.${field}`);
    }
    if (continuous) {
      if (record?.nextReviewAt !== null) errors.push(`active review schedule is forbidden: ${id}`);
      if (record?.acquiredAt !== null && !Number.isFinite(Date.parse(String(record?.acquiredAt || '')))) errors.push(`invalid ${id}.acquiredAt`);
      if (record?.state === 'acquired' && (record.passes < 1 || record.consecutivePasses < 1 || record.acquiredAt === null)) {
        errors.push(`acquired state lacks covered-once pass evidence: ${id}`);
      }
    }
    if (record?.lastEvidenceDigest !== null && !/^[0-9a-f]{64}$/.test(String(record?.lastEvidenceDigest || ''))) errors.push(`invalid ${id}.lastEvidenceDigest`);
    if (record?.lastRunId !== null && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(String(record?.lastRunId || ''))) errors.push(`invalid ${id}.lastRunId`);
  }
  if (!Array.isArray(state.pendingRepairs) || state.pendingRepairs.length > ids.size
      || new Set((state.pendingRepairs || []).map((row) => row?.failedConceptId)).size !== state.pendingRepairs?.length
      || state.pendingRepairs.some((row) => !ids.has(row?.failedConceptId)
        || !/^[0-9a-f]{64}$/.test(String(row?.evidenceDigest || ''))
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(String(row?.runId || '')))) errors.push('invalid pendingRepairs');
  if (!Array.isArray(state.appliedRunIds) || state.appliedRunIds.length > 100_000
      || new Set(state.appliedRunIds).size !== state.appliedRunIds.length) errors.push('invalid appliedRunIds');
  if (!Array.isArray(state.appliedRunReceipts) || state.appliedRunReceipts.length !== state.appliedRunIds?.length
      || new Set((state.appliedRunReceipts || []).map((row) => row?.runId)).size !== state.appliedRunReceipts?.length
      || (state.appliedRunReceipts || []).some((row) => !state.appliedRunIds?.includes(row?.runId)
        || !/^[0-9a-f]{64}$/.test(String(row?.artifactManifestDigest || '')))) errors.push('invalid appliedRunReceipts');
  if (continuous) {
    if (!Object.hasOwn(state, 'migration')) errors.push('continuous mastery state must declare migration');
    if (state.migration !== null) {
      const migration = state.migration;
      if (!migration || migration.schemaVersion !== 'cortex.learning_os.mastery_migration_receipt.v1'
          || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(String(migration.migrationId || ''))
          || !Number.isSafeInteger(migration.sourceRevision) || migration.sourceRevision < 0
          || migration.targetRevision !== state.revision
          || !/^[0-9a-f]{64}$/.test(String(migration.sourceStateDigest || ''))
          || !/^[0-9a-f]{64}$/.test(String(migration.sourcePolicyDigest || ''))
          || !/^[0-9a-f]{64}$/.test(String(migration.sourceCurriculumDigest || ''))
          || !/^[0-9a-f]{64}$/.test(String(migration.targetPolicyDigest || ''))
          || !/^[0-9a-f]{64}$/.test(String(migration.targetCurriculumDigest || ''))
          || !Number.isFinite(Date.parse(String(migration.migratedAt || '')))) {
        errors.push('invalid continuous mastery migration receipt');
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function verifyMasteryState(state, secret, options) {
  const validation = validateMasteryState(state, options);
  const errors = [...validation.errors];
  if (state?.signature?.algorithm !== MASTERY_SIGNATURE_ALGORITHM || state.signature.keyId !== keyId(secret)
      || !/^[0-9a-f]{64}$/.test(String(state.signature?.digest || ''))) errors.push('invalid mastery signature');
  else {
    const expected = crypto.createHmac('sha256', secret).update(canonicalJson(unsigned(state))).digest();
    const actual = Buffer.from(state.signature.digest, 'hex');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) errors.push('mastery signature mismatch');
  }
  return { ok: errors.length === 0, errors };
}

function plusDays(timestamp, days) {
  return new Date(Date.parse(timestamp) + days * 86_400_000).toISOString();
}

export function applyMasteryDelta({ state, delta, graph, policy, artifactManifestDigest } = {}) {
  const validation = validateMasteryState(state, { graph, policy });
  if (!validation.ok) throw new Error(`invalid mastery state: ${validation.errors.join('; ')}`);
  const continuous = isContinuousAcquisitionPolicy(policy);
  const expectedDeltaSchema = continuous
    ? 'cortex.learning_os.mastery_delta.v2'
    : 'cortex.learning_os.mastery_delta.v1';
  if (!delta || delta.schemaVersion !== expectedDeltaSchema) throw new Error('invalid mastery delta schemaVersion');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(String(delta.runId || ''))) throw new Error('invalid delta runId');
  if (!/^[0-9a-f]{64}$/.test(String(artifactManifestDigest || ''))) throw new Error('invalid adaptive artifact manifest digest');
  const existingReceipt = state.appliedRunReceipts.find((row) => row.runId === delta.runId);
  if (delta.baseRevision !== state.revision) {
    if (state.appliedRunIds.includes(delta.runId)) {
      if (existingReceipt?.artifactManifestDigest !== artifactManifestDigest) throw new Error('adaptive run artifact receipt mismatch');
      return state;
    }
    throw new Error('mastery delta base revision mismatch');
  }
  if (delta.policyDigest !== state.policyDigest || delta.curriculumId !== state.curriculumId || delta.capsuleId !== state.capsuleId) {
    throw new Error('mastery delta scope or policy mismatch');
  }
  if (state.appliedRunIds.includes(delta.runId)) {
    if (existingReceipt?.artifactManifestDigest !== artifactManifestDigest) throw new Error('adaptive run artifact receipt mismatch');
    return state;
  }
  if (!Array.isArray(delta.events) || delta.events.length < 1 || delta.events.length > policy.budgets.maxSteps) throw new Error('invalid mastery delta events');
  if (delta.completedAt !== delta.events.at(-1)?.completedAt) throw new Error('mastery delta completion timestamp mismatch');
  const concepts = structuredClone(state.concepts);
  let pendingRepairs = structuredClone(state.pendingRepairs);
  let priorTimestamp = Date.parse(state.updatedAt);
  for (const event of delta.events) {
    const record = concepts[event.conceptId];
    const roles = continuous ? CONTINUOUS_ROLES : LEGACY_ROLES;
    if (!record || typeof event.passed !== 'boolean' || !roles.has(event.role)
        || !Number.isFinite(Date.parse(String(event.completedAt || '')))
        || Date.parse(event.completedAt) < priorTimestamp
        || !/^[0-9a-f]{64}$/.test(String(event.evidenceDigest || ''))) throw new Error('invalid mastery event');
    priorTimestamp = Date.parse(event.completedAt);
    record.attempts += 1;
    record.lastAttemptedAt = event.completedAt;
    record.lastEvidenceDigest = event.evidenceDigest;
    record.lastRunId = delta.runId;
    if (event.passed) {
      record.passes += 1;
      record.consecutivePasses += 1;
      record.consecutiveFailures = 0;
      if (continuous) {
        record.state = 'acquired';
        record.acquiredAt = event.completedAt;
        record.nextReviewAt = null;
      } else {
        if (event.role === 'spaced-review') {
          record.lastReviewedAt = event.completedAt;
          record.reviewStage = Math.min(record.reviewStage + 1, policy.spacingDays.length - 1);
        }
        record.state = record.reviewStage >= policy.spacingDays.length - 1 ? 'mastered' : 'review';
        record.nextReviewAt = plusDays(event.completedAt, policy.spacingDays[record.reviewStage]);
      }
      pendingRepairs = pendingRepairs.filter((row) => row.failedConceptId !== event.conceptId);
    } else {
      record.failures += 1;
      record.consecutivePasses = 0;
      record.consecutiveFailures += 1;
      if (continuous) {
        record.state = 'learning';
        record.acquiredAt = null;
        record.nextReviewAt = null;
      } else {
        const wasReview = event.role === 'spaced-review' || ['review', 'mastered'].includes(record.state);
        record.state = wasReview ? 'lapsed' : 'learning';
        if (wasReview) record.reviewStage = policy.lapse.resetReviewStage;
        record.nextReviewAt = policy.lapse.scheduleImmediateRepair ? event.completedAt : null;
      }
      pendingRepairs = [
        ...pendingRepairs.filter((row) => row.failedConceptId !== event.conceptId),
        { failedConceptId: event.conceptId, evidenceDigest: event.evidenceDigest, runId: delta.runId },
      ];
    }
  }
  return {
    ...unsigned(state),
    revision: state.revision + 1,
    updatedAt: delta.completedAt,
    concepts,
    pendingRepairs,
    appliedRunIds: [...state.appliedRunIds, delta.runId],
    appliedRunReceipts: [...state.appliedRunReceipts, { runId: delta.runId, artifactManifestDigest }],
  };
}

function assertRegularOwnerOnly(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  if ((stat.mode & 0o077) !== 0) throw new Error(`${label} must be owner-only`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error(`${label} owner mismatch`);
}

export function readMasterySecret(secretPath) {
  assertRegularOwnerOnly(secretPath, 'mastery secret');
  const secret = fs.readFileSync(secretPath, 'utf8').trim();
  if (secret.length < 32 || secret.length > 4096) throw new Error('invalid mastery secret length');
  return secret;
}

export function atomicWriteMasteryState(statePath, state, secret, { graph, policy } = {}) {
  const validation = validateMasteryState(state, { graph, policy });
  if (!validation.ok) throw new Error(`refusing to persist invalid mastery state: ${validation.errors.join('; ')}`);
  const target = path.resolve(statePath);
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  fs.chmodSync(parent, 0o700);
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('mastery path cannot be a symlink');
  const signed = signMasteryState(state, secret);
  const temporary = path.join(parent, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(signed, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, target);
  fs.chmodSync(target, 0o600);
  const directory = fs.openSync(parent, fs.constants.O_RDONLY);
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  return signed;
}

export function initializeMasteryStore({ statePath, secretPath, graph, policy, now = new Date().toISOString() } = {}) {
  fs.mkdirSync(path.dirname(secretPath), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(secretPath)) fs.writeFileSync(secretPath, `${crypto.randomBytes(48).toString('base64url')}\n`, { mode: 0o600, flag: 'wx' });
  const secret = readMasterySecret(secretPath);
  if (fs.existsSync(statePath)) {
    assertRegularOwnerOnly(statePath, 'mastery state');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const result = verifyMasteryState(state, secret, { graph, policy });
    if (!result.ok) throw new Error(`mastery verification failed: ${result.errors.join('; ')}`);
    return { state, secret };
  }
  const state = atomicWriteMasteryState(statePath, createMasteryState({ graph, policy, now }), secret, { graph, policy });
  return { state, secret };
}
