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
  signMasteryState,
  validateMasteryState,
  verifyMasteryState,
} from './mastery-state.mjs';

export const ADDITIVE_MIGRATION_AUDIT_SCHEMA = 'cortex.learning_os.additive_graph_migration_audit.v1';
export const ADDITIVE_MIGRATION_RECEIPT_SCHEMA = 'cortex.learning_os.additive_graph_migration_receipt.v1';
export const ADDITIVE_MIGRATION_TRANSACTION_SCHEMA = 'cortex.learning_os.additive_graph_migration_transaction.v1';

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

function assertOwnerOnlyDirectory(directoryPath, label) {
  const stat = fs.lstatSync(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a non-symlink directory`);
  }
  if ((stat.mode & 0o077) !== 0) throw new Error(`${label} must be owner-only`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`${label} owner mismatch`);
  }
}

function atomicWriteAudit(auditPath, audit, { replace = false } = {}) {
  const target = path.resolve(auditPath);
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  fs.chmodSync(parent, 0o700);
  assertOwnerOnlyDirectory(parent, 'additive migration output directory');
  if (fs.existsSync(target)) {
    assertOwnerOnlyRegular(target, 'existing additive migration output');
  }
  if (!replace && fs.existsSync(target)) throw new Error('additive migration audit path already exists');
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

function signTransaction(payload, secret) {
  return {
    ...payload,
    signature: {
      algorithm: 'hmac-sha256',
      keyId: keyId(secret),
      digest: crypto.createHmac('sha256', secret).update(canonicalJson(payload)).digest('hex'),
    },
  };
}

function verifyTransaction(transaction, secret) {
  const { signature, ...payload } = transaction || {};
  if (payload.schemaVersion !== ADDITIVE_MIGRATION_TRANSACTION_SCHEMA
      || !['prepared', 'state_committed', 'committed'].includes(payload.phase)
      || signature?.algorithm !== 'hmac-sha256'
      || signature.keyId !== keyId(secret)
      || !/^[0-9a-f]{64}$/.test(String(signature.digest || ''))) return false;
  const expected = crypto.createHmac('sha256', secret).update(canonicalJson(payload)).digest();
  const actual = Buffer.from(signature.digest, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function unsignedState(state) {
  const { signature: _signature, ...payload } = state || {};
  return payload;
}

function stateMatchesAudit(state, audit, secret, { targetGraph, targetPolicy }) {
  const verification = verifyMasteryState(state, secret, { graph: targetGraph, policy: targetPolicy });
  const receipt = state?.graphMigrations?.at(-1);
  return verification.ok
    && verifyAdditiveMigrationAudit(audit, secret)
    && state.revision === audit.target.revision
    && sha256Text(canonicalJson(unsignedState(state))) === audit.target.unsignedStateDigest
    && receipt?.migrationId === audit.migrationId
    && receipt.targetGraphDigest === audit.target.graphDigest
    && receipt.targetPolicyDigest === audit.target.policyDigest;
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
  sourceTree,
  expectedSourceTree,
  now = new Date().toISOString(),
} = {}) {
  if (sourceState?.schemaVersion !== MASTERY_SCHEMA) throw new Error('additive migration source must be signed v2 state');
  if (!Number.isSafeInteger(expectedSourceRevision) || expectedSourceRevision < 0
      || sourceState.revision !== expectedSourceRevision) throw new Error('additive migration source revision mismatch');
  if (!/^[0-9a-f]{40}$/.test(String(sourceCommit || ''))
      || sourceCommit !== expectedSourceCommit) throw new Error('additive migration source commit mismatch');
  if (!/^[0-9a-f]{40}$/.test(String(sourceTree || ''))
      || sourceTree !== expectedSourceTree) throw new Error('additive migration source tree mismatch');
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
    sourceTree,
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
    sourceTree,
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
  journalPath = null,
  onPhase = null,
  ...options
} = {}) {
  if (!statePath || !secretPath || !auditPath) throw new Error('additive migration state, secret, and audit paths are required');
  const resolvedState = path.resolve(statePath);
  const resolvedAudit = path.resolve(auditPath);
  const resolvedJournal = path.resolve(journalPath || `${resolvedAudit}.transaction.json`);
  if (new Set([resolvedState, resolvedAudit, resolvedJournal]).size !== 3) {
    throw new Error('additive migration state, audit, and transaction journal paths must differ');
  }
  assertOwnerOnlyRegular(resolvedState, 'additive migration source state');
  const secret = readMasterySecret(secretPath);
  let currentState = JSON.parse(fs.readFileSync(resolvedState, 'utf8'));
  if (fs.existsSync(resolvedAudit)) {
    assertOwnerOnlyRegular(resolvedAudit, 'existing additive migration audit');
  }
  if (fs.existsSync(resolvedJournal)) {
    assertOwnerOnlyRegular(resolvedJournal, 'existing additive migration transaction journal');
  }
  let legacyAudit = null;
  if (fs.existsSync(resolvedAudit) && !fs.existsSync(resolvedJournal)) {
    const audit = JSON.parse(fs.readFileSync(resolvedAudit, 'utf8'));
    if (stateMatchesAudit(currentState, audit, secret, options)) {
      const recoveredTransaction = signTransaction({
        schemaVersion: ADDITIVE_MIGRATION_TRANSACTION_SCHEMA,
        migrationId: audit.migrationId,
        phase: 'committed',
        statePath: resolvedState,
        auditPath: resolvedAudit,
        sourceStateDigest: audit.source.stateDigest,
        targetStateDigest: sha256Text(canonicalJson(currentState)),
        targetState: currentState,
        audit,
        preparedAt: audit.migratedAt,
        stateCommittedAt: currentState.updatedAt,
        committedAt: new Date().toISOString(),
        truthBoundary: 'A legacy audit-first partial transaction was reconciled against the exact signed target state and upgraded to a durable committed journal.',
      }, secret);
      atomicWriteAudit(resolvedJournal, recoveredTransaction);
      return {
        state: currentState,
        audit,
        auditPath: resolvedAudit,
        journalPath: resolvedJournal,
        recovered: true,
        alreadyApplied: true,
      };
    }
    if (!verifyAdditiveMigrationAudit(audit, secret)) {
      throw new Error('existing additive migration audit is invalid');
    }
    if (audit.source?.stateDigest !== sha256Text(canonicalJson(currentState))) {
      throw new Error('existing additive migration audit matches neither source nor target state');
    }
    legacyAudit = audit;
  }
  let transaction;
  if (fs.existsSync(resolvedJournal)) {
    assertOwnerOnlyRegular(resolvedJournal, 'additive migration transaction journal');
    transaction = JSON.parse(fs.readFileSync(resolvedJournal, 'utf8'));
    if (!verifyTransaction(transaction, secret)
        || transaction.statePath !== resolvedState
        || transaction.auditPath !== resolvedAudit) {
      throw new Error('additive migration transaction journal is invalid or out of scope');
    }
  } else {
    const built = buildAdditiveMasteryMigration({
      ...options,
      now: legacyAudit?.migratedAt || options.now,
      sourceState: currentState,
      secret,
    });
    if (fs.existsSync(resolvedAudit)) {
      const existingAudit = JSON.parse(fs.readFileSync(resolvedAudit, 'utf8'));
      if (canonicalJson(existingAudit) !== canonicalJson(built.audit)) {
        throw new Error('existing additive migration audit conflicts with deterministic recovery');
      }
    }
    const signedTargetState = signMasteryState(built.targetState, secret);
    transaction = signTransaction({
      schemaVersion: ADDITIVE_MIGRATION_TRANSACTION_SCHEMA,
      migrationId: built.audit.migrationId,
      phase: 'prepared',
      statePath: resolvedState,
      auditPath: resolvedAudit,
      sourceStateDigest: sha256Text(canonicalJson(currentState)),
      targetStateDigest: sha256Text(canonicalJson(signedTargetState)),
      targetState: signedTargetState,
      audit: built.audit,
      preparedAt: new Date().toISOString(),
      truthBoundary: 'Prepared is recoverable intent only. The migration is committed only when signed target state and signed audit are both durable.',
    }, secret);
    atomicWriteAudit(resolvedJournal, transaction);
    onPhase?.('prepared');
  }
  if (transaction.phase === 'committed') {
    const audit = JSON.parse(fs.readFileSync(resolvedAudit, 'utf8'));
    if (!stateMatchesAudit(currentState, audit, secret, options)
        || canonicalJson(audit) !== canonicalJson(transaction.audit)) {
      throw new Error('committed additive migration transaction does not match durable state and audit');
    }
    return {
      state: currentState,
      audit,
      auditPath: resolvedAudit,
      journalPath: resolvedJournal,
      recovered: true,
      alreadyApplied: true,
    };
  }
  if (sha256Text(canonicalJson(currentState)) === transaction.sourceStateDigest) {
    const state = atomicWriteMasteryState(resolvedState, transaction.targetState, secret, {
      graph: options.targetGraph,
      policy: options.targetPolicy,
    });
    currentState = state;
    onPhase?.('state_written');
  } else if (sha256Text(canonicalJson(currentState)) !== transaction.targetStateDigest) {
    throw new Error('additive migration recovery found neither frozen source nor target state');
  }
  transaction = signTransaction({
    ...unsignedState(transaction),
    phase: 'state_committed',
    stateCommittedAt: new Date().toISOString(),
  }, secret);
  atomicWriteAudit(resolvedJournal, transaction, { replace: true });
  onPhase?.('state_committed');
  if (fs.existsSync(resolvedAudit)) {
    const existing = JSON.parse(fs.readFileSync(resolvedAudit, 'utf8'));
    if (canonicalJson(existing) !== canonicalJson(transaction.audit)) {
      throw new Error('additive migration recovery audit conflicts with prepared transaction');
    }
  } else {
    atomicWriteAudit(resolvedAudit, transaction.audit);
  }
  onPhase?.('audit_written');
  transaction = signTransaction({
    ...unsignedState(transaction),
    phase: 'committed',
    committedAt: new Date().toISOString(),
    truthBoundary: 'Both the signed target state and signed additive audit are durable and were reconciled through this transaction journal.',
  }, secret);
  atomicWriteAudit(resolvedJournal, transaction, { replace: true });
  return {
    state: currentState,
    audit: transaction.audit,
    auditPath: resolvedAudit,
    journalPath: resolvedJournal,
    recovered: transaction.preparedAt !== transaction.stateCommittedAt,
    alreadyApplied: false,
  };
}
