import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { isContinuousAcquisitionPolicy, policyDigest } from './adaptive-policy.mjs';
import { validateCurriculumGraph } from './curriculum-planner.mjs';
import { sha256Text } from './hash.mjs';
import {
  MASTERY_SCHEMA,
  atomicWriteMasteryState,
  defaultContinuousConcept,
  readMasterySecret,
  validateMasteryState,
  verifyMasteryState,
} from './mastery-state.mjs';

export const ADDITIVE_MIGRATION_AUDIT_SCHEMA = 'cortex.learning_os.additive_graph_migration_audit.v1';
export const ADDITIVE_MIGRATION_RECEIPT_SCHEMA = 'cortex.learning_os.additive_graph_migration_receipt.v1';

function digestGraph(graph, label) {
  const validation = validateCurriculumGraph(graph);
  if (!validation.ok) throw new Error(`invalid ${label} graph: ${validation.errors.join('; ')}`);
  return sha256Text(canonicalJson(graph));
}

function assertDigest(value, label) {
  if (!/^[0-9a-f]{64}$/.test(String(value || ''))) throw new Error(`${label} must be a SHA-256 digest`);
}

function keyId(secret) {
  return sha256Text(secret).slice(0, 16);
}

function signAudit(payload, secret) {
  return {
    ...payload,
    signature: {
      algorithm: 'hmac-sha256',
      keyId: keyId(secret),
      digest: crypto.createHmac('sha256', secret).update(canonicalJson(payload)).digest('hex'),
    },
  };
}

export function verifyAdditiveMigrationAudit(audit, secret) {
  const { signature, ...payload } = audit || {};
  if (payload.schemaVersion !== ADDITIVE_MIGRATION_AUDIT_SCHEMA
      || signature?.algorithm !== 'hmac-sha256'
      || signature.keyId !== keyId(secret)
      || !/^[0-9a-f]{64}$/.test(String(signature.digest || ''))) return false;
  const expected = crypto.createHmac('sha256', secret).update(canonicalJson(payload)).digest();
  const actual = Buffer.from(signature.digest, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function assertOwnerOnlyRegular(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  if ((stat.mode & 0o077) !== 0) throw new Error(`${label} must be owner-only`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error(`${label} owner mismatch`);
}

function atomicWriteAudit(auditPath, audit) {
  const target = path.resolve(auditPath);
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  fs.chmodSync(parent, 0o700);
  if (fs.existsSync(target)) throw new Error('additive migration audit path already exists');
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
  return target;
}

export function buildAdditiveMasteryMigration({
  sourceState,
  secret,
  sourceGraph,
  sourcePolicy,
  targetGraph,
  targetPolicy,
  expectedSourceRevision,
  expectedSourceStateDigest,
  expectedSourceGraphDigest,
  expectedSourcePolicyDigest,
  expectedTargetGraphDigest,
  expectedTargetPolicyDigest,
  sourceCommit,
  expectedSourceCommit,
  now = new Date().toISOString(),
} = {}) {
  if (sourceState?.schemaVersion !== MASTERY_SCHEMA) throw new Error('additive migration source must be signed v2 state');
  if (!Number.isSafeInteger(expectedSourceRevision) || expectedSourceRevision < 0
      || sourceState.revision !== expectedSourceRevision) throw new Error('additive migration source revision mismatch');
  if (!/^[0-9a-f]{40}$/.test(String(sourceCommit || ''))
      || sourceCommit !== expectedSourceCommit) throw new Error('additive migration source commit mismatch');
  for (const [value, label] of [
    [expectedSourceStateDigest, 'expected source state digest'],
    [expectedSourceGraphDigest, 'expected source graph digest'],
    [expectedSourcePolicyDigest, 'expected source policy digest'],
    [expectedTargetGraphDigest, 'expected target graph digest'],
    [expectedTargetPolicyDigest, 'expected target policy digest'],
  ]) assertDigest(value, label);

  const actualSourceStateDigest = sha256Text(canonicalJson(sourceState));
  const actualSourceGraphDigest = digestGraph(sourceGraph, 'source');
  const actualTargetGraphDigest = digestGraph(targetGraph, 'target');
  const actualSourcePolicyDigest = policyDigest(sourcePolicy);
  const actualTargetPolicyDigest = policyDigest(targetPolicy);
  for (const [actual, expected, label] of [
    [actualSourceStateDigest, expectedSourceStateDigest, 'source state'],
    [actualSourceGraphDigest, expectedSourceGraphDigest, 'source graph'],
    [actualSourcePolicyDigest, expectedSourcePolicyDigest, 'source policy'],
    [actualTargetGraphDigest, expectedTargetGraphDigest, 'target graph'],
    [actualTargetPolicyDigest, expectedTargetPolicyDigest, 'target policy'],
  ]) {
    if (actual !== expected) throw new Error(`additive migration ${label} digest mismatch`);
  }
  if (!isContinuousAcquisitionPolicy(sourcePolicy) || !isContinuousAcquisitionPolicy(targetPolicy)
      || sourcePolicy.reviewSelection?.enabled !== false || targetPolicy.reviewSelection?.enabled !== false) {
    throw new Error('additive migration requires acquisition-only source and target policies');
  }
  if (sourcePolicy.curriculumId !== sourceGraph.curriculumId || sourcePolicy.capsuleId !== sourceGraph.capsuleId
      || targetPolicy.curriculumId !== targetGraph.curriculumId || targetPolicy.capsuleId !== targetGraph.capsuleId) {
    throw new Error('additive migration graph and policy scopes differ');
  }
  const verified = verifyMasteryState(sourceState, secret, { graph: sourceGraph, policy: sourcePolicy });
  if (!verified.ok) throw new Error(`additive migration source signature or state invalid: ${verified.errors.join('; ')}`);

  const sourceById = new Map(sourceGraph.concepts.map((concept) => [concept.conceptId, concept]));
  const targetById = new Map(targetGraph.concepts.map((concept) => [concept.conceptId, concept]));
  const removed = [...sourceById.keys()].filter((conceptId) => !targetById.has(conceptId));
  if (removed.length) throw new Error(`additive migration removes source concepts: ${removed.join(', ')}`);
  const rewritten = [...sourceById].filter(([conceptId, concept]) => canonicalJson(concept) !== canonicalJson(targetById.get(conceptId)));
  if (rewritten.length) throw new Error(`additive migration rewrites source concepts: ${rewritten.map(([id]) => id).join(', ')}`);
  const addedConceptIds = targetGraph.concepts
    .map((concept) => concept.conceptId)
    .filter((conceptId) => !sourceById.has(conceptId));
  if (addedConceptIds.length < 1) throw new Error('additive migration adds no new concepts or repeats a completed migration');
  if ((sourceState.graphMigrations || []).some((receipt) => receipt.targetGraphDigest === actualTargetGraphDigest)) {
    throw new Error('additive migration target was already applied');
  }
  if (!Number.isFinite(Date.parse(String(now || ''))) || Date.parse(now) < Date.parse(sourceState.updatedAt)) {
    throw new Error('additive migration timestamp is invalid or non-monotonic');
  }

  const concepts = {};
  for (const concept of targetGraph.concepts) {
    concepts[concept.conceptId] = sourceById.has(concept.conceptId)
      ? structuredClone(sourceState.concepts[concept.conceptId])
      : defaultContinuousConcept();
  }
  const migrationId = `additive-r${sourceState.revision}-${actualTargetGraphDigest.slice(0, 16)}`;
  const receipt = {
    schemaVersion: ADDITIVE_MIGRATION_RECEIPT_SCHEMA,
    migrationId,
    sourceRevision: sourceState.revision,
    targetRevision: sourceState.revision + 1,
    sourceStateDigest: actualSourceStateDigest,
    sourceGraphDigest: actualSourceGraphDigest,
    targetGraphDigest: actualTargetGraphDigest,
    sourcePolicyDigest: actualSourcePolicyDigest,
    targetPolicyDigest: actualTargetPolicyDigest,
    sourceCommit,
    migratedAt: now,
    addedConceptIds,
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
    migration: structuredClone(sourceState.migration),
    graphMigrations: [...structuredClone(sourceState.graphMigrations || []), receipt],
  };
  const targetValidation = validateMasteryState(targetState, { graph: targetGraph, policy: targetPolicy });
  if (!targetValidation.ok) throw new Error(`additive migrated state is invalid: ${targetValidation.errors.join('; ')}`);
  for (const conceptId of sourceById.keys()) {
    if (canonicalJson(targetState.concepts[conceptId]) !== canonicalJson(sourceState.concepts[conceptId])) {
      throw new Error(`additive migration changed source concept evidence: ${conceptId}`);
    }
  }
  for (const [left, right, label] of [
    [targetState.pendingRepairs, sourceState.pendingRepairs, 'pending repairs'],
    [targetState.appliedRunIds, sourceState.appliedRunIds, 'applied run IDs'],
    [targetState.appliedRunReceipts, sourceState.appliedRunReceipts, 'applied run receipts'],
    [targetState.migration, sourceState.migration, 'prior migration receipt'],
    [targetState.graphMigrations.slice(0, -1), sourceState.graphMigrations || [], 'prior additive migration receipts'],
  ]) {
    if (canonicalJson(left) !== canonicalJson(right)) throw new Error(`additive migration changed ${label}`);
  }
  const auditPayload = {
    schemaVersion: ADDITIVE_MIGRATION_AUDIT_SCHEMA,
    migrationId,
    sourceCommit,
    migratedAt: now,
    source: {
      revision: sourceState.revision,
      stateDigest: actualSourceStateDigest,
      signatureDigest: sourceState.signature.digest,
      graphDigest: actualSourceGraphDigest,
      policyDigest: actualSourcePolicyDigest,
      conceptCount: sourceById.size,
    },
    target: {
      revision: targetState.revision,
      unsignedStateDigest: sha256Text(canonicalJson(targetState)),
      graphDigest: actualTargetGraphDigest,
      policyDigest: actualTargetPolicyDigest,
      conceptCount: targetById.size,
    },
    preservation: {
      conceptsDigest: sha256Text(canonicalJson(sourceState.concepts)),
      pendingRepairsDigest: sha256Text(canonicalJson(sourceState.pendingRepairs)),
      appliedRunIdsDigest: sha256Text(canonicalJson(sourceState.appliedRunIds)),
      appliedRunReceiptsDigest: sha256Text(canonicalJson(sourceState.appliedRunReceipts)),
      priorMigrationReceiptDigest: sha256Text(canonicalJson(sourceState.migration)),
      priorAdditiveMigrationReceiptsDigest: sha256Text(canonicalJson(sourceState.graphMigrations || [])),
    },
    addedConceptIds,
    truthBoundary: 'This audit proves an additive signed-state graph expansion only. Existing evidence is unchanged and new concepts are unassessed; no retention, broad qualification, or model-weight change is asserted.',
  };
  return { targetState, audit: signAudit(auditPayload, secret) };
}

export function migrateAdditiveMasteryStore({
  statePath,
  secretPath,
  auditPath,
  ...options
} = {}) {
  if (!statePath || !secretPath || !auditPath) throw new Error('additive migration state, secret, and audit paths are required');
  const resolvedState = path.resolve(statePath);
  const resolvedAudit = path.resolve(auditPath);
  if (resolvedState === resolvedAudit) throw new Error('additive migration audit must differ from state path');
  assertOwnerOnlyRegular(resolvedState, 'additive migration source state');
  if (fs.existsSync(resolvedAudit)) throw new Error('additive migration audit path already exists');
  const secret = readMasterySecret(secretPath);
  const sourceState = JSON.parse(fs.readFileSync(resolvedState, 'utf8'));
  const built = buildAdditiveMasteryMigration({ ...options, sourceState, secret });
  atomicWriteAudit(resolvedAudit, built.audit);
  try {
    const state = atomicWriteMasteryState(resolvedState, built.targetState, secret, {
      graph: options.targetGraph,
      policy: options.targetPolicy,
    });
    return { state, audit: built.audit, auditPath: resolvedAudit };
  } catch (error) {
    try { fs.unlinkSync(resolvedAudit); } catch {}
    throw error;
  }
}
