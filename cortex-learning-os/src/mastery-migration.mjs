import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { isContinuousAcquisitionPolicy, policyDigest } from './adaptive-policy.mjs';
import { validateCurriculumGraph } from './curriculum-planner.mjs';
import { sha256Text } from './hash.mjs';
import {
  LEGACY_MASTERY_SCHEMA,
  MASTERY_SCHEMA,
  atomicWriteMasteryState,
  defaultContinuousConcept,
  readMasterySecret,
  validateMasteryState,
  verifyMasteryState,
} from './mastery-state.mjs';

export const MASTERY_MIGRATION_AUDIT_SCHEMA = 'cortex.learning_os.mastery_migration_audit.v1';
export const MASTERY_MIGRATION_RECEIPT_SCHEMA = 'cortex.learning_os.mastery_migration_receipt.v1';

function graphDigest(graph) {
  const validation = validateCurriculumGraph(graph);
  if (!validation.ok) throw new Error(`invalid migration curriculum graph: ${validation.errors.join('; ')}`);
  return sha256Text(canonicalJson(graph));
}

function assertDigest(value, label) {
  if (!/^[0-9a-f]{64}$/.test(String(value || ''))) throw new Error(`${label} must be a SHA-256 digest`);
}

function assertRegularOwnerOnly(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  if ((stat.mode & 0o077) !== 0) throw new Error(`${label} must be owner-only`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error(`${label} owner mismatch`);
}

function auditKeyId(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 16);
}

function signAudit(payload, secret) {
  return {
    ...payload,
    signature: {
      algorithm: 'hmac-sha256',
      keyId: auditKeyId(secret),
      digest: crypto.createHmac('sha256', secret).update(canonicalJson(payload)).digest('hex'),
    },
  };
}

export function verifyMasteryMigrationAudit(audit, secret) {
  const { signature, ...payload } = audit || {};
  if (payload.schemaVersion !== MASTERY_MIGRATION_AUDIT_SCHEMA
      || signature?.algorithm !== 'hmac-sha256'
      || signature.keyId !== auditKeyId(secret)
      || !/^[0-9a-f]{64}$/.test(String(signature.digest || ''))) return false;
  const expected = crypto.createHmac('sha256', secret).update(canonicalJson(payload)).digest();
  const actual = Buffer.from(signature.digest, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function atomicWriteAudit(auditPath, audit) {
  const target = path.resolve(auditPath);
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  fs.chmodSync(parent, 0o700);
  if (fs.existsSync(target)) throw new Error('migration audit path already exists');
  const temporary = path.join(parent, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(audit, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, target);
  fs.chmodSync(target, 0o600);
  const directory = fs.openSync(parent, fs.constants.O_RDONLY);
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

function mapLegacyConcept(record) {
  const acquired = ['review', 'mastered'].includes(record.state);
  const state = acquired
    ? 'acquired'
    : record.state === 'unassessed'
      ? 'unassessed'
      : record.state === 'blocked_prerequisite'
        ? 'blocked_prerequisite'
        : 'learning';
  return {
    state,
    attempts: record.attempts,
    passes: record.passes,
    failures: record.failures,
    consecutivePasses: record.consecutivePasses,
    consecutiveFailures: record.consecutiveFailures,
    historicalReviewStage: record.reviewStage,
    lastAttemptedAt: record.lastAttemptedAt,
    lastReviewedAt: record.lastReviewedAt,
    historicalNextReviewAt: record.nextReviewAt,
    nextReviewAt: null,
    acquiredAt: acquired ? (record.lastAttemptedAt || record.lastReviewedAt) : null,
    lastEvidenceDigest: record.lastEvidenceDigest,
    lastRunId: record.lastRunId,
  };
}

function preservationDigest(concepts, fields) {
  return sha256Text(canonicalJson(Object.fromEntries(Object.entries(concepts).map(([conceptId, record]) => [
    conceptId,
    Object.fromEntries(fields.map((field) => [field, record[field]])),
  ]))));
}

export function buildContinuousMasteryMigration({
  sourceState,
  secret,
  legacyGraph,
  legacyPolicy,
  targetGraph,
  targetPolicy,
  expectedSourceRevision,
  expectedSourceStateDigest,
  expectedSourceCurriculumDigest,
  expectedSourcePolicyDigest,
  expectedTargetCurriculumDigest,
  expectedTargetPolicyDigest,
  sourceCommit,
  expectedSourceCommit,
  now = new Date().toISOString(),
} = {}) {
  if (sourceState?.schemaVersion !== LEGACY_MASTERY_SCHEMA) {
    if (sourceState?.schemaVersion === MASTERY_SCHEMA) throw new Error('mastery state was already migrated');
    throw new Error('migration source must be a legacy mastery state');
  }
  if (!Number.isSafeInteger(expectedSourceRevision) || expectedSourceRevision < 0
      || sourceState.revision !== expectedSourceRevision) throw new Error('migration source revision mismatch');
  if (!/^[0-9a-f]{40}$/.test(String(sourceCommit || ''))
      || sourceCommit !== expectedSourceCommit) throw new Error('migration source commit mismatch');
  for (const [value, label] of [
    [expectedSourceStateDigest, 'expected source state digest'],
    [expectedSourceCurriculumDigest, 'expected source curriculum digest'],
    [expectedSourcePolicyDigest, 'expected source policy digest'],
    [expectedTargetCurriculumDigest, 'expected target curriculum digest'],
    [expectedTargetPolicyDigest, 'expected target policy digest'],
  ]) assertDigest(value, label);
  const actualSourceStateDigest = sha256Text(canonicalJson(sourceState));
  const actualSourceCurriculumDigest = graphDigest(legacyGraph);
  const actualSourcePolicyDigest = policyDigest(legacyPolicy);
  const actualTargetCurriculumDigest = graphDigest(targetGraph);
  const actualTargetPolicyDigest = policyDigest(targetPolicy);
  for (const [actual, expected, label] of [
    [actualSourceStateDigest, expectedSourceStateDigest, 'source state'],
    [actualSourceCurriculumDigest, expectedSourceCurriculumDigest, 'source curriculum'],
    [actualSourcePolicyDigest, expectedSourcePolicyDigest, 'source policy'],
    [actualTargetCurriculumDigest, expectedTargetCurriculumDigest, 'target curriculum'],
    [actualTargetPolicyDigest, expectedTargetPolicyDigest, 'target policy'],
  ]) {
    if (actual !== expected) throw new Error(`migration ${label} digest mismatch`);
  }
  if (!isContinuousAcquisitionPolicy(targetPolicy)) throw new Error('migration target policy is not continuous acquisition');
  const verified = verifyMasteryState(sourceState, secret, { graph: legacyGraph, policy: legacyPolicy });
  if (!verified.ok) throw new Error(`legacy mastery verification failed: ${verified.errors.join('; ')}`);

  const legacyById = new Map(legacyGraph.concepts.map((concept) => [concept.conceptId, concept]));
  const targetById = new Map(targetGraph.concepts.map((concept) => [concept.conceptId, concept]));
  const removed = [...legacyById.keys()].filter((conceptId) => !targetById.has(conceptId));
  if (removed.length) throw new Error(`target curriculum removes legacy concepts: ${removed.join(', ')}`);
  const rewritten = [...legacyById].filter(([conceptId, concept]) => canonicalJson(concept) !== canonicalJson(targetById.get(conceptId)));
  if (rewritten.length) throw new Error(`target curriculum rewrites legacy concepts: ${rewritten.map(([id]) => id).join(', ')}`);
  const addedConceptIds = targetGraph.concepts.map((concept) => concept.conceptId).filter((conceptId) => !legacyById.has(conceptId));
  if (addedConceptIds.length < 1) throw new Error('target curriculum adds no acquisition frontier');
  if (!Number.isFinite(Date.parse(String(now || ''))) || Date.parse(now) < Date.parse(sourceState.updatedAt)) {
    throw new Error('invalid or non-monotonic migration timestamp');
  }

  const concepts = {};
  for (const concept of targetGraph.concepts) {
    concepts[concept.conceptId] = legacyById.has(concept.conceptId)
      ? mapLegacyConcept(sourceState.concepts[concept.conceptId])
      : defaultContinuousConcept();
  }
  const migrationId = `continuous-acquisition-r${sourceState.revision}-to-r${sourceState.revision + 1}`;
  const receipt = {
    schemaVersion: MASTERY_MIGRATION_RECEIPT_SCHEMA,
    migrationId,
    sourceRevision: sourceState.revision,
    targetRevision: sourceState.revision + 1,
    sourceStateDigest: actualSourceStateDigest,
    sourcePolicyDigest: actualSourcePolicyDigest,
    sourceCurriculumDigest: actualSourceCurriculumDigest,
    targetPolicyDigest: actualTargetPolicyDigest,
    targetCurriculumDigest: actualTargetCurriculumDigest,
    migratedAt: now,
  };
  const targetState = {
    schemaVersion: MASTERY_SCHEMA,
    revision: sourceState.revision + 1,
    curriculumId: targetGraph.curriculumId,
    capsuleId: targetGraph.capsuleId,
    policyDigest: actualTargetPolicyDigest,
    updatedAt: now,
    concepts,
    pendingRepairs: structuredClone(sourceState.pendingRepairs),
    appliedRunIds: structuredClone(sourceState.appliedRunIds),
    appliedRunReceipts: structuredClone(sourceState.appliedRunReceipts),
    migration: receipt,
  };
  const targetValidation = validateMasteryState(targetState, { graph: targetGraph, policy: targetPolicy });
  if (!targetValidation.ok) throw new Error(`migrated mastery state is invalid: ${targetValidation.errors.join('; ')}`);

  const preservedFields = [
    'attempts', 'passes', 'failures', 'consecutivePasses', 'consecutiveFailures',
    'lastAttemptedAt', 'lastReviewedAt', 'lastEvidenceDigest', 'lastRunId',
  ];
  const sourcePreservationDigest = preservationDigest(sourceState.concepts, preservedFields);
  const migratedLegacyConcepts = Object.fromEntries([...legacyById.keys()].map((id) => [id, targetState.concepts[id]]));
  const targetPreservationDigest = preservationDigest(migratedLegacyConcepts, preservedFields);
  if (sourcePreservationDigest !== targetPreservationDigest
      || canonicalJson(sourceState.pendingRepairs) !== canonicalJson(targetState.pendingRepairs)
      || canonicalJson(sourceState.appliedRunIds) !== canonicalJson(targetState.appliedRunIds)
      || canonicalJson(sourceState.appliedRunReceipts) !== canonicalJson(targetState.appliedRunReceipts)) {
    throw new Error('migration failed evidence-preservation invariant');
  }
  const auditPayload = {
    schemaVersion: MASTERY_MIGRATION_AUDIT_SCHEMA,
    migrationId,
    sourceCommit,
    migratedAt: now,
    source: {
      schemaVersion: sourceState.schemaVersion,
      revision: sourceState.revision,
      stateDigest: actualSourceStateDigest,
      signatureDigest: sourceState.signature.digest,
      curriculumId: sourceState.curriculumId,
      curriculumDigest: actualSourceCurriculumDigest,
      policyDigest: actualSourcePolicyDigest,
      conceptCount: legacyById.size,
    },
    target: {
      schemaVersion: targetState.schemaVersion,
      revision: targetState.revision,
      unsignedStateDigest: sha256Text(canonicalJson(targetState)),
      curriculumId: targetState.curriculumId,
      curriculumDigest: actualTargetCurriculumDigest,
      policyDigest: actualTargetPolicyDigest,
      conceptCount: targetById.size,
    },
    preservation: {
      attemptPassFailureAndEvidenceDigest: sourcePreservationDigest,
      appliedRunIdsDigest: sha256Text(canonicalJson(sourceState.appliedRunIds)),
      appliedRunReceiptsDigest: sha256Text(canonicalJson(sourceState.appliedRunReceipts)),
      pendingRepairsDigest: sha256Text(canonicalJson(sourceState.pendingRepairs)),
      historicalReviewTimestampDigest: preservationDigest(sourceState.concepts, ['lastReviewedAt', 'nextReviewAt']),
    },
    convertedAcquiredConceptCount: Object.values(sourceState.concepts)
      .filter((record) => ['review', 'mastered'].includes(record.state)).length,
    clearedActiveReviewScheduleCount: Object.values(sourceState.concepts)
      .filter((record) => record.nextReviewAt !== null).length,
    addedConceptIds,
    truthBoundary: 'Migration preserves historical evidence and converts passed legacy review/mastered labels to covered-once acquired state. It proves no durable retention, general math mastery, or model-weight learning.',
  };
  return { targetState, audit: signAudit(auditPayload, secret) };
}

export function migrateMasteryStore({
  statePath,
  secretPath,
  auditPath,
  ...options
} = {}) {
  if (!statePath || !secretPath || !auditPath) throw new Error('state, secret, and audit paths are required');
  const resolvedState = path.resolve(statePath);
  const resolvedAudit = path.resolve(auditPath);
  if (resolvedState === resolvedAudit) throw new Error('migration audit path must differ from mastery state path');
  assertRegularOwnerOnly(resolvedState, 'legacy mastery state');
  const secret = readMasterySecret(secretPath);
  const sourceState = JSON.parse(fs.readFileSync(resolvedState, 'utf8'));
  const built = buildContinuousMasteryMigration({ ...options, sourceState, secret });
  atomicWriteAudit(resolvedAudit, built.audit);
  const state = atomicWriteMasteryState(resolvedState, built.targetState, secret, {
    graph: options.targetGraph,
    policy: options.targetPolicy,
  });
  return { state, audit: built.audit, auditPath: resolvedAudit };
}
