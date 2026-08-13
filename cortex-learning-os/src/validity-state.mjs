import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { sha256Text } from './hash.mjs';
import {
  createAuthorityAttestation,
  verifyAuthorityAttestation,
} from './phd-trust.mjs';

export const VALIDITY_STATE_SCHEMA = 'cortex.learning_os.validity_state.v1';
export const VALIDITY_STATES = Object.freeze([
  'validity_pending',
  'validity_confirmed',
  'validity_failed',
  'validity_blocked',
]);

const DIGEST = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const ROLES = new Set(['validity-direct', 'validity-compositional']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isRecord(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function validityStateCore(state) {
  const { stateSha256: _stateSha256, graderAttestation: _graderAttestation, ...core } = state || {};
  return core;
}

export function validityStateSha256(state) {
  return sha256Text(canonicalJson(validityStateCore(state)));
}

export function validityGraderPayload(state) {
  return {
    subjectSchemaVersion: VALIDITY_STATE_SCHEMA,
    subjectId: state?.campaignId,
    subjectDigest: state?.stateSha256,
    bankDigest: state?.bank?.bankDigest,
    sourceCommit: state?.source?.sourceCommit,
    role: 'grader',
  };
}

function validateItemResult(item, conceptId) {
  const errors = [];
  if (!exactKeys(item, [
    'assessmentRole',
    'executionEvidenceSha256',
    'itemContentDigest',
    'itemId',
    'observedAnswerSha256',
    'score',
    'semanticFamilyId',
    'status',
    'verifierEvidenceSha256',
  ])
      || !IDENTIFIER.test(String(item?.itemId || ''))
      || !IDENTIFIER.test(String(item?.semanticFamilyId || ''))
      || !ROLES.has(item?.assessmentRole)
      || !['passed', 'failed', 'error'].includes(item?.status)
      || ![0, 1].includes(item?.score)
      || ![
        item?.itemContentDigest,
        item?.observedAnswerSha256,
        item?.verifierEvidenceSha256,
      ].every((value) => DIGEST.test(String(value || '')))
      || !(item.executionEvidenceSha256 === null
        || DIGEST.test(String(item.executionEvidenceSha256 || '')))) {
    errors.push(`${conceptId}: invalid validity item result`);
  }
  if ((item?.status === 'passed') !== (item?.score === 1)) {
    errors.push(`${conceptId}: validity item status and score contradict`);
  }
  return errors;
}

function validateConceptRow(row, expectedConceptIds) {
  const errors = [];
  if (!exactKeys(row, [
    'acquisitionEvidenceDigest',
    'acquisitionState',
    'blockedReasons',
    'completedAt',
    'conceptId',
    'errorItemCount',
    'failedItemCount',
    'itemResults',
    'passedItemCount',
    'requiredItemCount',
    'score',
    'sessionId',
    'validityState',
  ])
      || !IDENTIFIER.test(String(row?.conceptId || ''))
      || !expectedConceptIds.has(row?.conceptId)
      || row?.acquisitionState !== 'acquired_once'
      || !DIGEST.test(String(row?.acquisitionEvidenceDigest || ''))
      || !VALIDITY_STATES.includes(row?.validityState)
      || row?.requiredItemCount !== 2
      || !Number.isSafeInteger(row?.passedItemCount)
      || !Number.isSafeInteger(row?.failedItemCount)
      || !Number.isSafeInteger(row?.errorItemCount)
      || row.passedItemCount < 0 || row.failedItemCount < 0 || row.errorItemCount < 0
      || !Number.isFinite(row?.score) || row.score < 0 || row.score > 1
      || !Array.isArray(row?.itemResults) || row.itemResults.length > 2
      || !Array.isArray(row?.blockedReasons)
      || row.blockedReasons.some((reason) => typeof reason !== 'string' || reason.length < 1 || reason.length > 3000)
      || !(row?.sessionId === null || IDENTIFIER.test(String(row.sessionId || '')))
      || !(row?.completedAt === null || timestamp(row.completedAt))) {
    errors.push(`${String(row?.conceptId || 'unknown')}: invalid validity concept row`);
    return errors;
  }
  for (const item of row.itemResults) errors.push(...validateItemResult(item, row.conceptId));
  const roles = row.itemResults.map((item) => item.assessmentRole);
  if (new Set(roles).size !== roles.length) errors.push(`${row.conceptId}: duplicate validity role result`);
  const passed = row.itemResults.filter((item) => item.status === 'passed').length;
  const failed = row.itemResults.filter((item) => item.status === 'failed').length;
  const errored = row.itemResults.filter((item) => item.status === 'error').length;
  if (passed !== row.passedItemCount || failed !== row.failedItemCount || errored !== row.errorItemCount
      || Number((row.itemResults.length ? passed / row.requiredItemCount : 0).toFixed(6)) !== row.score) {
    errors.push(`${row.conceptId}: validity item aggregates mismatch`);
  }
  const compositionalPassed = row.itemResults.some((item) => (
    item.assessmentRole === 'validity-compositional' && item.status === 'passed'
  ));
  if (row.validityState === 'validity_confirmed'
      && (row.itemResults.length !== 2 || passed !== 2 || failed !== 0 || errored !== 0
        || row.score < 0.8 || !compositionalPassed || row.blockedReasons.length !== 0
        || row.sessionId === null || row.completedAt === null)) {
    errors.push(`${row.conceptId}: confirmed validity threshold is not met`);
  }
  if (row.validityState === 'validity_failed'
      && (row.itemResults.length !== 2 || errored !== 0 || passed === 2
        || row.blockedReasons.length !== 0 || row.sessionId === null || row.completedAt === null)) {
    errors.push(`${row.conceptId}: failed validity state is contradictory`);
  }
  if (row.validityState === 'validity_blocked'
      && row.blockedReasons.length < 1) {
    errors.push(`${row.conceptId}: blocked validity state has no blocker`);
  }
  if (row.validityState === 'validity_pending'
      && (row.itemResults.length !== 0 || row.blockedReasons.length !== 0
        || row.sessionId !== null || row.completedAt !== null)) {
    errors.push(`${row.conceptId}: pending validity state contains scored evidence`);
  }
  return errors;
}

export function validateValidityState(state, {
  conceptIds = [],
  trustPolicy,
  expectedSource = null,
  expectedBank = null,
  expectedAcquisition = null,
} = {}) {
  const errors = [];
  const expectedConceptIds = new Set(conceptIds);
  if (!exactKeys(state, [
    'acquisition',
    'bank',
    'campaignId',
    'concepts',
    'counts',
    'generatedAt',
    'graderAttestation',
    'schemaVersion',
    'source',
    'stateSha256',
    'threshold',
    'truthBoundary',
  ])) {
    return { ok: false, errors: ['validity state fields are incomplete or unknown'] };
  }
  if (state.schemaVersion !== VALIDITY_STATE_SCHEMA
      || !IDENTIFIER.test(String(state.campaignId || ''))
      || !timestamp(state.generatedAt)
      || typeof state.truthBoundary !== 'string' || state.truthBoundary.length < 1
      || !DIGEST.test(String(state.stateSha256 || ''))) {
    errors.push('validity state identity, timestamp, digest, or truth boundary is invalid');
  }
  if (!exactKeys(state.source, ['productTree', 'sourceCommit', 'sourceTree'])
      || !COMMIT.test(String(state.source?.sourceCommit || ''))
      || !COMMIT.test(String(state.source?.sourceTree || ''))
      || !COMMIT.test(String(state.source?.productTree || ''))) {
    errors.push('validity source identity is invalid');
  }
  if (!exactKeys(state.bank, ['bankDigest', 'bankId', 'bankSha256', 'campaign'])
      || !IDENTIFIER.test(String(state.bank?.bankId || ''))
      || ![state.bank?.bankDigest, state.bank?.bankSha256].every((value) => DIGEST.test(String(value || '')))
      || !exactKeys(state.bank?.campaign, ['campaignDigest', 'campaignId'])
      || !IDENTIFIER.test(String(state.bank?.campaign?.campaignId || ''))
      || !DIGEST.test(String(state.bank?.campaign?.campaignDigest || ''))) {
    errors.push('validity bank identity is invalid');
  }
  if (!exactKeys(state.acquisition, [
    'acquiredOnceCount',
    'revision',
    'stateSha256',
  ])
      || !Number.isSafeInteger(state.acquisition?.revision) || state.acquisition.revision < 0
      || state.acquisition?.acquiredOnceCount !== expectedConceptIds.size
      || !DIGEST.test(String(state.acquisition?.stateSha256 || ''))) {
    errors.push('validity acquisition binding is invalid');
  }
  if (!exactKeys(state.threshold, [
    'minimumScore',
    'requireAllFamilies',
    'requireCompositionalPass',
    'requiredRoles',
    'undeclaredToolsAllowed',
  ])
      || state.threshold?.minimumScore !== 0.8
      || state.threshold?.requireAllFamilies !== true
      || state.threshold?.requireCompositionalPass !== true
      || canonicalJson(state.threshold?.requiredRoles) !== canonicalJson([...ROLES])
      || state.threshold?.undeclaredToolsAllowed !== false) {
    errors.push('validity threshold contract is invalid');
  }
  if (!Array.isArray(state.concepts)
      || state.concepts.length !== expectedConceptIds.size
      || new Set(state.concepts.map((row) => row?.conceptId)).size !== expectedConceptIds.size) {
    errors.push('validity concept surface is incomplete or duplicated');
  }
  for (const row of state.concepts || []) {
    errors.push(...validateConceptRow(row, expectedConceptIds));
  }
  const counted = {
    conceptCount: state.concepts.length,
    acquiredOnce: state.concepts.filter((row) => row.acquisitionState === 'acquired_once').length,
    validityPending: state.concepts.filter((row) => row.validityState === 'validity_pending').length,
    validityConfirmed: state.concepts.filter((row) => row.validityState === 'validity_confirmed').length,
    validityFailed: state.concepts.filter((row) => row.validityState === 'validity_failed').length,
    validityBlocked: state.concepts.filter((row) => row.validityState === 'validity_blocked').length,
  };
  if (!exactKeys(state.counts, Object.keys(counted))
      || canonicalJson(state.counts) !== canonicalJson(counted)) {
    errors.push('validity aggregate counts mismatch');
  }
  if (expectedSource !== null && canonicalJson(state.source) !== canonicalJson(expectedSource)) {
    errors.push('validity source differs from the expected immutable source');
  }
  if (expectedBank !== null && canonicalJson(state.bank) !== canonicalJson(expectedBank)) {
    errors.push('validity bank differs from the expected signed bank');
  }
  if (expectedAcquisition !== null
      && canonicalJson(state.acquisition) !== canonicalJson(expectedAcquisition)) {
    errors.push('validity acquisition snapshot differs from the expected signed state');
  }
  const computedDigest = validityStateSha256(state);
  if (state.stateSha256 !== computedDigest) errors.push('validity state digest mismatch');
  const expectedPayload = validityGraderPayload(state);
  if (!verifyAuthorityAttestation(state.graderAttestation, {
    trustPolicy,
    capability: 'grader',
  }) || canonicalJson(state.graderAttestation?.payload) !== canonicalJson(expectedPayload)) {
    errors.push('validity grader attestation is invalid or detached');
  }
  return { ok: errors.length === 0, errors, counts: counted };
}

export function signValidityState(state, {
  trustPolicy,
  privateKeyPem,
  conceptIds,
  expectedSource = null,
  expectedBank = null,
  expectedAcquisition = null,
} = {}) {
  if (state?.stateSha256 !== null || state?.graderAttestation !== null) {
    throw new Error('validity state signing requires an unsigned state');
  }
  const prepared = {
    ...structuredClone(state),
    stateSha256: validityStateSha256(state),
  };
  prepared.graderAttestation = createAuthorityAttestation({
    trustPolicy,
    privateKeyPem,
    capability: 'grader',
    attestationId: `validity-grader-${prepared.stateSha256.slice(0, 32)}`,
    payload: validityGraderPayload(prepared),
  });
  const validation = validateValidityState(prepared, {
    conceptIds,
    trustPolicy,
    expectedSource,
    expectedBank,
    expectedAcquisition,
  });
  if (!validation.ok) {
    throw new Error(`signed validity state failed validation: ${validation.errors.join('; ')}`);
  }
  return prepared;
}
