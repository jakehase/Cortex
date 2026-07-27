import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { sha256Text } from './hash.mjs';

export const TRANSFER_STATE_SCHEMA = 'cortex.learning_os.transfer_state.v1';
export const TRANSFER_STATE_SIGNATURE_ALGORITHM = 'hmac-sha256';
const STATES = new Set(['unassessed', 'candidate', 'qualified', 'expired', 'revoked', 'no_qualified_transfer']);
const OUTCOMES = new Set(['qualified', 'candidate', 'no-transfer', 'invalid', 'blocked', 'underpowered', 'null']);
const DIGEST = /^[0-9a-f]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

function unsigned(state) {
  const { signature: _signature, ...payload } = state;
  return payload;
}

function keyId(secret) {
  return sha256Text(secret).slice(0, 16);
}

function emptyConcept(profileIds, profileDigests) {
  return profileIds.length
    ? {
      state: 'unassessed',
      profileIds,
      profileDigests,
      reasonCode: 'declared-transfer-surface-unassessed',
      qualificationRunId: null,
      artifactManifestDigest: null,
      evidenceDigest: null,
      qualifiedAt: null,
      expiresAt: null,
    }
    : {
      state: 'no_qualified_transfer',
      profileIds: [],
      profileDigests: [],
      reasonCode: 'no-declared-transfer-surface',
      qualificationRunId: null,
      artifactManifestDigest: null,
      evidenceDigest: null,
      qualifiedAt: null,
      expiresAt: null,
    };
}

function profileMap(profiles) {
  const result = new Map();
  for (const profile of profiles) {
    for (const conceptId of profile.mathConceptIds) {
      const rows = result.get(conceptId) || [];
      rows.push({ profileId: profile.profileId, profileDigest: profile.source.profileDigest });
      result.set(conceptId, rows.sort((left, right) => left.profileId.localeCompare(right.profileId)));
    }
  }
  return result;
}

export function createTransferState({ graph, policy, profiles, now = new Date().toISOString() } = {}) {
  if (!Array.isArray(graph?.concepts) || graph.concepts.length !== 36) throw new Error('transfer initialization requires the exact 36-concept curriculum');
  const declared = profileMap(profiles);
  return {
    schemaVersion: TRANSFER_STATE_SCHEMA,
    revision: 0,
    curriculumId: graph.curriculumId,
    capsuleId: graph.capsuleId,
    policyDigest: sha256Text(canonicalJson(policy)),
    updatedAt: now,
    concepts: Object.fromEntries(graph.concepts.map((concept) => [
      concept.conceptId,
      emptyConcept(
        (declared.get(concept.conceptId) || []).map((row) => row.profileId),
        (declared.get(concept.conceptId) || []).map((row) => row.profileDigest),
      ),
    ])),
    appliedRunReceipts: [],
  };
}

export function signTransferState(state, secret) {
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 4096) throw new Error('transfer state HMAC secret is missing or invalid');
  const payload = unsigned(state);
  return {
    ...payload,
    signature: {
      algorithm: TRANSFER_STATE_SIGNATURE_ALGORITHM,
      keyId: keyId(secret),
      digest: crypto.createHmac('sha256', secret).update(canonicalJson(payload)).digest('hex'),
    },
  };
}

export function validateTransferState(state, { graph, policy, profiles } = {}) {
  const errors = [];
  if (!state || typeof state !== 'object' || Array.isArray(state)) return { ok: false, errors: ['transfer state must be an object'] };
  const allowed = new Set(['schemaVersion', 'revision', 'curriculumId', 'capsuleId', 'policyDigest', 'updatedAt', 'concepts', 'appliedRunReceipts', 'signature']);
  if (Object.keys(state).some((key) => !allowed.has(key))) errors.push('transfer state has additional properties');
  if (state.schemaVersion !== TRANSFER_STATE_SCHEMA) errors.push('invalid transfer state schemaVersion');
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) errors.push('invalid transfer revision');
  if (state.curriculumId !== graph?.curriculumId || state.capsuleId !== graph?.capsuleId) errors.push('transfer state scope mismatch');
  if (state.policyDigest !== sha256Text(canonicalJson(policy))) errors.push('transfer policy drift');
  if (!Number.isFinite(Date.parse(String(state.updatedAt || '')))) errors.push('invalid transfer updatedAt');
  const ids = new Set((graph?.concepts || []).map((concept) => concept.conceptId));
  const declared = profileMap(profiles || []);
  if (!state.concepts || typeof state.concepts !== 'object' || Array.isArray(state.concepts)
      || Object.keys(state.concepts).length !== 36
      || Object.keys(state.concepts).some((id) => !ids.has(id))) errors.push('transfer concept set mismatch');
  for (const [conceptId, value] of Object.entries(state.concepts || {})) {
    const keys = new Set(['state', 'profileIds', 'profileDigests', 'reasonCode', 'qualificationRunId', 'artifactManifestDigest', 'evidenceDigest', 'qualifiedAt', 'expiresAt']);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.has(key))) {
      errors.push(`invalid transfer concept record: ${conceptId}`);
      continue;
    }
    if (!STATES.has(value.state)) errors.push(`invalid transfer state: ${conceptId}`);
    const expectedRows = declared.get(conceptId) || [];
    const expectedProfiles = expectedRows.map((row) => row.profileId);
    const expectedDigests = expectedRows.map((row) => row.profileDigest);
    if (!Array.isArray(value.profileIds) || canonicalJson(value.profileIds) !== canonicalJson(expectedProfiles)
        || !Array.isArray(value.profileDigests) || canonicalJson(value.profileDigests) !== canonicalJson(expectedDigests)) errors.push(`transfer profile binding mismatch: ${conceptId}`);
    if (!expectedRows.length && (value.state !== 'no_qualified_transfer' || value.reasonCode !== 'no-declared-transfer-surface')) errors.push(`undeclared concept is not explicit no-transfer: ${conceptId}`);
    if (typeof value.reasonCode !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value.reasonCode)) errors.push(`invalid reasonCode: ${conceptId}`);
    if (value.qualificationRunId !== null && !RUN_ID.test(String(value.qualificationRunId))) errors.push(`invalid qualificationRunId: ${conceptId}`);
    for (const field of ['artifactManifestDigest', 'evidenceDigest']) {
      if (value[field] !== null && !DIGEST.test(String(value[field]))) errors.push(`invalid ${field}: ${conceptId}`);
    }
    for (const field of ['qualifiedAt', 'expiresAt']) {
      if (value[field] !== null && !Number.isFinite(Date.parse(String(value[field])))) errors.push(`invalid ${field}: ${conceptId}`);
    }
    if (value.state === 'qualified' && (!value.qualificationRunId || !value.artifactManifestDigest || !value.evidenceDigest
      || !value.qualifiedAt || !value.expiresAt || Date.parse(value.expiresAt) <= Date.parse(value.qualifiedAt))) errors.push(`incomplete qualification binding: ${conceptId}`);
  }
  if (!Array.isArray(state.appliedRunReceipts) || state.appliedRunReceipts.length > 100000
      || new Set((state.appliedRunReceipts || []).map((row) => row?.runId)).size !== state.appliedRunReceipts?.length
      || state.appliedRunReceipts.some((row) => !row || Object.keys(row).some((key) => !['runId', 'artifactManifestDigest', 'outcome'].includes(key))
        || !RUN_ID.test(String(row.runId || '')) || !DIGEST.test(String(row.artifactManifestDigest || '')) || !OUTCOMES.has(row.outcome))) errors.push('invalid appliedRunReceipts');
  if (state.signature !== undefined && (!state.signature || typeof state.signature !== 'object' || Array.isArray(state.signature)
      || Object.keys(state.signature).some((key) => !['algorithm', 'keyId', 'digest'].includes(key)))) errors.push('invalid transfer signature shape');
  return { ok: errors.length === 0, errors };
}

export function verifyTransferState(state, secret, options) {
  const validation = validateTransferState(state, options);
  const errors = [...validation.errors];
  if (state?.signature?.algorithm !== TRANSFER_STATE_SIGNATURE_ALGORITHM
      || state.signature.keyId !== keyId(secret) || !DIGEST.test(String(state.signature?.digest || ''))) errors.push('invalid transfer state signature');
  else {
    const expected = crypto.createHmac('sha256', secret).update(canonicalJson(unsigned(state))).digest();
    const actual = Buffer.from(state.signature.digest, 'hex');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) errors.push('transfer state signature mismatch');
  }
  return { ok: errors.length === 0, errors };
}

export function applyTransferQualification({ state, report, profile, graph, policy, profiles } = {}) {
  const validation = validateTransferState(state, { graph, policy, profiles });
  if (!validation.ok) throw new Error(`invalid transfer state: ${validation.errors.join('; ')}`);
  if (report?.schemaVersion !== 'cortex.learning_os.transfer_promotion_report.v1'
      || report.profileId !== profile.profileId || !RUN_ID.test(String(report.runId || ''))
      || !DIGEST.test(String(report.artifactManifestDigest || '')) || !OUTCOMES.has(report.outcome)) throw new Error('invalid transfer qualification report');
  if (report.frozenDigests?.profile !== profile.source.profileDigest
      || report.frozenDigests?.policy !== sha256Text(canonicalJson(policy))
      || report.frozenDigests?.source !== profile.source.sourceDigest
      || !DIGEST.test(String(report.frozenDigests?.tasks || ''))
      || !DIGEST.test(String(report.frozenDigests?.plan || ''))
      || !DIGEST.test(String(report.evidenceDigest || ''))) throw new Error('transfer report frozen digest mismatch');
  if (report.outcome === 'qualified' && (!report.gates || !Object.values(report.gates).every((value) => value === true))) {
    throw new Error('qualified transfer report has a failed gate');
  }
  const receipt = state.appliedRunReceipts.find((row) => row.runId === report.runId);
  if (receipt) {
    if (receipt.artifactManifestDigest !== report.artifactManifestDigest) throw new Error('transfer run artifact receipt mismatch');
    return state;
  }
  const concepts = structuredClone(state.concepts);
  const stateForOutcome = report.outcome === 'qualified'
    ? 'qualified'
    : ['candidate', 'underpowered', 'invalid', 'blocked'].includes(report.outcome)
      ? 'candidate'
      : 'no_qualified_transfer';
  for (const conceptId of profile.mathConceptIds) {
    concepts[conceptId] = {
      ...concepts[conceptId],
      state: stateForOutcome,
      reasonCode: `qualification-outcome-${report.outcome}`,
      qualificationRunId: report.runId,
      artifactManifestDigest: report.artifactManifestDigest,
      evidenceDigest: report.evidenceDigest,
      qualifiedAt: report.outcome === 'qualified' ? report.evaluatedAt : null,
      expiresAt: report.outcome === 'qualified'
        ? new Date(Date.parse(report.evaluatedAt) + policy.qualificationTtlDays * 86_400_000).toISOString()
        : null,
    };
  }
  return {
    ...unsigned(state),
    revision: state.revision + 1,
    updatedAt: report.evaluatedAt,
    concepts,
    appliedRunReceipts: [...state.appliedRunReceipts, {
      runId: report.runId,
      artifactManifestDigest: report.artifactManifestDigest,
      outcome: report.outcome,
    }],
  };
}

export function setTransferProfileState({ state, profile, nextState, reasonCode, now = new Date().toISOString() } = {}) {
  if (!['revoked', 'expired', 'candidate', 'no_qualified_transfer'].includes(nextState)) throw new Error('invalid manual transfer state transition');
  const concepts = structuredClone(state.concepts);
  for (const conceptId of profile.mathConceptIds) {
    const current = concepts[conceptId];
    concepts[conceptId] = {
      ...current,
      state: nextState,
      reasonCode,
      qualifiedAt: nextState === 'expired' || nextState === 'revoked' ? current.qualifiedAt : null,
      expiresAt: nextState === 'expired' || nextState === 'revoked' ? current.expiresAt : null,
    };
  }
  return { ...unsigned(state), revision: state.revision + 1, updatedAt: now, concepts };
}

function assertOwnerFile(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  if ((stat.mode & 0o077) !== 0) throw new Error(`${label} must be owner-only`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error(`${label} owner mismatch`);
}

export function readTransferStateSecret(secretPath) {
  assertOwnerFile(secretPath, 'transfer state secret');
  const secret = fs.readFileSync(secretPath, 'utf8').trim();
  if (secret.length < 32 || secret.length > 4096) throw new Error('invalid transfer state secret length');
  return secret;
}

export function atomicWriteTransferState(statePath, state, secret, options) {
  const validation = validateTransferState(state, options);
  if (!validation.ok) throw new Error(`refusing invalid transfer state: ${validation.errors.join('; ')}`);
  const target = path.resolve(statePath);
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  fs.chmodSync(parent, 0o700);
  if (fs.existsSync(target)) assertOwnerFile(target, 'transfer state');
  const signed = signTransferState(state, secret);
  const signedValidation = verifyTransferState(signed, secret, options);
  if (!signedValidation.ok) throw new Error(`refusing invalid signed transfer state: ${signedValidation.errors.join('; ')}`);
  const temporary = path.join(parent, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
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

export function initializeTransferStore({ statePath, secretPath, graph, policy, profiles, now = new Date().toISOString() } = {}) {
  fs.mkdirSync(path.dirname(secretPath), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(secretPath)) fs.writeFileSync(secretPath, `${crypto.randomBytes(48).toString('base64url')}\n`, { mode: 0o600, flag: 'wx' });
  const secret = readTransferStateSecret(secretPath);
  if (fs.existsSync(statePath)) {
    assertOwnerFile(statePath, 'transfer state');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const verification = verifyTransferState(state, secret, { graph, policy, profiles });
    if (!verification.ok) throw new Error(`transfer state verification failed: ${verification.errors.join('; ')}`);
    return { state, secret };
  }
  const state = atomicWriteTransferState(
    statePath,
    createTransferState({ graph, policy, profiles, now }),
    secret,
    { graph, policy, profiles },
  );
  return { state, secret };
}
