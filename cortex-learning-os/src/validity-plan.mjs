import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { sha256Text } from './hash.mjs';
import {
  createAuthorityAttestation,
  verifyAuthorityAttestation,
} from './phd-trust.mjs';

export const VALIDITY_PLAN_SCHEMA = 'cortex.learning_os.validity_plan.v1';

const DIGEST = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const REQUIRED_ROLES = Object.freeze([
  'validity-direct',
  'validity-compositional',
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isRecord(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function validTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function validityPlanCore(plan) {
  const { planSha256: _planSha256, proctorAttestation: _proctorAttestation, ...core } = plan || {};
  return core;
}

export function validityPlanSha256(plan) {
  return sha256Text(canonicalJson(validityPlanCore(plan)));
}

export function validityPlanAttestationPayload(plan) {
  return {
    subjectSchemaVersion: VALIDITY_PLAN_SCHEMA,
    subjectId: plan?.campaignId,
    subjectDigest: plan?.planSha256,
    bankDigest: plan?.bank?.bankDigest,
    acquisitionStateSha256: plan?.acquisition?.stateSha256,
    sourceCommit: plan?.source?.sourceCommit,
    role: 'proctor',
  };
}

export function validateValidityPlan(plan, {
  trustPolicy,
  conceptIds = [],
  expectedSource = null,
  expectedBank = null,
  expectedAcquisition = null,
} = {}) {
  const errors = [];
  const expectedConceptIds = new Set(conceptIds);
  if (!exactKeys(plan, [
    'acquisition',
    'bank',
    'campaignId',
    'expiresAt',
    'generatedAt',
    'modelRuntime',
    'notBefore',
    'planSha256',
    'proctorAttestation',
    'schemaVersion',
    'sessions',
    'source',
    'threshold',
    'truthBoundary',
  ])) {
    return { ok: false, errors: ['validity plan fields are incomplete or unknown'] };
  }
  if (plan.schemaVersion !== VALIDITY_PLAN_SCHEMA
      || !IDENTIFIER.test(String(plan.campaignId || ''))
      || !validTimestamp(plan.generatedAt)
      || !validTimestamp(plan.notBefore)
      || !validTimestamp(plan.expiresAt)
      || Date.parse(plan.notBefore) > Date.parse(plan.generatedAt)
      || Date.parse(plan.expiresAt) <= Date.parse(plan.generatedAt)
      || Date.parse(plan.expiresAt) - Date.parse(plan.generatedAt) > 172_800_000
      || !DIGEST.test(String(plan.planSha256 || ''))
      || typeof plan.truthBoundary !== 'string' || plan.truthBoundary.length < 1) {
    errors.push('validity plan identity, timestamp, digest, or truth boundary is invalid');
  }
  if (!exactKeys(plan.source, ['productTree', 'sourceCommit', 'sourceTree'])
      || !COMMIT.test(String(plan.source?.sourceCommit || ''))
      || !COMMIT.test(String(plan.source?.sourceTree || ''))
      || !COMMIT.test(String(plan.source?.productTree || ''))) {
    errors.push('validity plan source identity is invalid');
  }
  if (!exactKeys(plan.bank, ['bankDigest', 'bankId', 'bankSha256', 'campaign'])
      || !IDENTIFIER.test(String(plan.bank?.bankId || ''))
      || ![plan.bank?.bankDigest, plan.bank?.bankSha256].every((value) => DIGEST.test(String(value || '')))
      || !exactKeys(plan.bank?.campaign, ['campaignDigest', 'campaignId'])
      || !IDENTIFIER.test(String(plan.bank?.campaign?.campaignId || ''))
      || !DIGEST.test(String(plan.bank?.campaign?.campaignDigest || ''))) {
    errors.push('validity plan bank identity is invalid');
  }
  if (!exactKeys(plan.acquisition, [
    'acquiredOnceCount',
    'concepts',
    'revision',
    'stateSha256',
  ])
      || !Number.isSafeInteger(plan.acquisition?.revision) || plan.acquisition.revision < 0
      || plan.acquisition?.acquiredOnceCount !== expectedConceptIds.size
      || !DIGEST.test(String(plan.acquisition?.stateSha256 || ''))
      || !Array.isArray(plan.acquisition?.concepts)
      || plan.acquisition.concepts.length !== expectedConceptIds.size
      || new Set(plan.acquisition.concepts.map((row) => row?.conceptId)).size !== expectedConceptIds.size) {
    errors.push('validity plan acquisition binding is invalid');
  } else {
    for (const row of plan.acquisition.concepts) {
      if (!exactKeys(row, [
        'acquiredAt',
        'conceptId',
        'evidenceDigest',
        'runId',
      ])
          || !IDENTIFIER.test(String(row.conceptId || ''))
          || !expectedConceptIds.has(row.conceptId)
          || !validTimestamp(row.acquiredAt)
          || !DIGEST.test(String(row.evidenceDigest || ''))
          || !IDENTIFIER.test(String(row.runId || ''))) {
        errors.push(`invalid acquired-once plan binding: ${String(row?.conceptId || 'unknown')}`);
      }
    }
  }
  if (!exactKeys(plan.modelRuntime, [
    'model',
    'provider',
    'sandbox',
    'thinking',
    'toolsAllowed',
  ])
      || plan.modelRuntime?.provider !== 'openai-codex'
      || plan.modelRuntime?.model !== 'gpt-5.6-sol'
      || !['xhigh', 'ultra'].includes(plan.modelRuntime?.thinking)
      || plan.modelRuntime?.sandbox !== 'read-only'
      || plan.modelRuntime?.toolsAllowed !== false) {
    errors.push('validity plan model runtime is invalid');
  }
  if (!exactKeys(plan.threshold, [
    'minimumScore',
    'requireAllFamilies',
    'requireCompositionalPass',
    'requiredRoles',
    'undeclaredToolsAllowed',
  ])
      || plan.threshold?.minimumScore !== 0.8
      || plan.threshold?.requireAllFamilies !== true
      || plan.threshold?.requireCompositionalPass !== true
      || canonicalJson(plan.threshold?.requiredRoles) !== canonicalJson(REQUIRED_ROLES)
      || plan.threshold?.undeclaredToolsAllowed !== false) {
    errors.push('validity plan threshold is invalid');
  }
  if (!Array.isArray(plan.sessions)
      || plan.sessions.length !== expectedConceptIds.size
      || new Set(plan.sessions.map((row) => row?.conceptId)).size !== expectedConceptIds.size
      || new Set(plan.sessions.map((row) => row?.sessionId)).size !== expectedConceptIds.size
      || new Set(plan.sessions.map((row) => row?.jobId)).size !== expectedConceptIds.size) {
    errors.push('validity plan session surface is incomplete or duplicated');
  } else {
    for (const session of plan.sessions) {
      if (!exactKeys(session, [
        'conceptId',
        'itemContentDigests',
        'itemIds',
        'jobId',
        'jobSha256',
        'sessionId',
        'taskSha256',
      ])
          || !IDENTIFIER.test(String(session.conceptId || ''))
          || !expectedConceptIds.has(session.conceptId)
          || !IDENTIFIER.test(String(session.sessionId || ''))
          || !IDENTIFIER.test(String(session.jobId || ''))
          || !Array.isArray(session.itemIds) || session.itemIds.length !== 2
          || new Set(session.itemIds).size !== 2
          || session.itemIds.some((itemId) => !IDENTIFIER.test(String(itemId || '')))
          || !Array.isArray(session.itemContentDigests) || session.itemContentDigests.length !== 2
          || session.itemContentDigests.some((digest) => !DIGEST.test(String(digest || '')))
          || !DIGEST.test(String(session.taskSha256 || ''))
          || !DIGEST.test(String(session.jobSha256 || ''))) {
        errors.push(`invalid validity session: ${String(session?.conceptId || 'unknown')}`);
      }
    }
  }
  if (expectedSource !== null && canonicalJson(plan.source) !== canonicalJson(expectedSource)) {
    errors.push('validity plan source differs from the expected immutable source');
  }
  if (expectedBank !== null && canonicalJson(plan.bank) !== canonicalJson(expectedBank)) {
    errors.push('validity plan bank differs from the expected signed bank');
  }
  if (expectedAcquisition !== null) {
    const acquisitionCore = {
      revision: plan.acquisition?.revision,
      stateSha256: plan.acquisition?.stateSha256,
      acquiredOnceCount: plan.acquisition?.acquiredOnceCount,
    };
    if (canonicalJson(acquisitionCore) !== canonicalJson(expectedAcquisition)) {
      errors.push('validity plan acquisition snapshot differs from the expected signed state');
    }
  }
  const computedDigest = validityPlanSha256(plan);
  if (plan.planSha256 !== computedDigest) errors.push('validity plan digest mismatch');
  const expectedPayload = validityPlanAttestationPayload(plan);
  if (!verifyAuthorityAttestation(plan.proctorAttestation, {
    trustPolicy,
    capability: 'proctor',
  }) || canonicalJson(plan.proctorAttestation?.payload) !== canonicalJson(expectedPayload)) {
    errors.push('validity plan proctor attestation is invalid or detached');
  }
  return { ok: errors.length === 0, errors };
}

export function signValidityPlan(plan, {
  trustPolicy,
  privateKeyPem,
  conceptIds,
  expectedSource = null,
  expectedBank = null,
  expectedAcquisition = null,
} = {}) {
  if (plan?.planSha256 !== null || plan?.proctorAttestation !== null) {
    throw new Error('validity plan signing requires an unsigned plan');
  }
  const prepared = {
    ...structuredClone(plan),
    planSha256: validityPlanSha256(plan),
  };
  prepared.proctorAttestation = createAuthorityAttestation({
    trustPolicy,
    privateKeyPem,
    capability: 'proctor',
    attestationId: `validity-proctor-${prepared.planSha256.slice(0, 32)}`,
    payload: validityPlanAttestationPayload(prepared),
  });
  const validation = validateValidityPlan(prepared, {
    trustPolicy,
    conceptIds,
    expectedSource,
    expectedBank,
    expectedAcquisition,
  });
  if (!validation.ok) {
    throw new Error(`signed validity plan failed validation: ${validation.errors.join('; ')}`);
  }
  return prepared;
}
