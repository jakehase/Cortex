import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { atomicWriteAuthenticatedJson } from './authenticated-file-publication.mjs';
import {
  assertDeploymentBinding,
  assertModelQualificationDeployment,
  assertQualificationDeployment,
  APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA,
  deploymentBindingDigest,
  FROZEN_DEPLOYMENT_BINDING_SCHEMA,
  MODEL_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA,
  sourceDeploymentBinding,
  validateDeploymentBinding,
} from './deployment-identity.mjs';
import {
  executionSourceSha256,
  validateExecutionEvidenceRecord,
} from './execution-evidence.mjs';
import { replayGeneratedExercise, verifyGeneratedAnswer } from './generated-exercises.mjs';
import { assertExecutionClosureAtRoot } from './git-product-source.mjs';
import { sha256Bytes, sha256Text } from './hash.mjs';
import {
  linuxDescriptorMountAccess,
  linuxDescriptorMountId,
} from './linux-descriptor-identity.mjs';
import { assertInitialRootAuthority } from './linux-root-authority.mjs';
import { validatePhdTrustPolicy, verifyTrustedExecutionEvidence } from './phd-trust.mjs';
import {
  assertProcessRuntimeClosure,
  assertProcessRuntimeClosureServiceAccess,
  buildProcessRuntimeClosure,
  PROCESS_RUNTIME_STORE_ROOT,
  validateProcessRuntimeClosure,
} from './process-runtime-closure.mjs';
import {
  executeIndependentAssessmentFixtureItem,
  executeIndependentAssessmentItem,
  INDEPENDENT_ASSESSMENT_ITEM_SCHEMA,
  materializeIndependentAssessmentItem,
  validateIndependentAssessmentBank,
  validateIndependentAssessmentFixtureBank,
  validateIndependentAssessmentFixtureItem,
  validateIndependentAssessmentItem,
} from './phd-assessment.mjs';
import { assertRetentionResumeBindings } from './retention-resume-binding.mjs';

export const RETENTION_TASK_SCHEMA = 'cortex.learning_os.retention_window_task.v2';
export const RETENTION_RELEASE_SCHEMA = 'cortex.learning_os.retention_window_release.v1';
export const RETENTION_JOB_TASK_SCHEMA =
  'cortex.learning_os.phd_retention_job_task.v1';

function assertRetentionExecutionDeployment(executionDeployment, sourceDeployment) {
  if (executionDeployment?.schemaVersion
      === MODEL_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA) {
    return assertModelQualificationDeployment(executionDeployment, sourceDeployment);
  }
  if (executionDeployment?.schemaVersion
      === APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA) {
    return assertQualificationDeployment(executionDeployment, sourceDeployment);
  }
  return assertDeploymentBinding(executionDeployment, sourceDeployment, {
    requiredContentIds: [
      'graph', 'rubric', 'blueprint', 'acquisition-policy',
      'retention-policy', 'trust-policy',
    ],
  });
}

function retentionJobTaskRecord({ task, release, executionDeployment }) {
  if (executionDeployment?.schemaVersion
      === MODEL_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA) {
    return {
      schemaVersion: RETENTION_JOB_TASK_SCHEMA,
      signedTask: task,
      release,
    };
  }
  return {
    schemaVersion: 'cortex.learning_os.retention_job_task.v1',
    signedTask: task,
    release,
    taskSha256: digestRecord(task),
    releaseSha256: digestRecord(release),
  };
}
export const RETENTION_EVIDENCE_SCHEMA = 'cortex.learning_os.retention_window_evidence.v2';
export const RETENTION_STATUS_SCHEMA = 'cortex.learning_os.retention_status.v2';
export const RETENTION_WAIT_SCHEMA = 'cortex.learning_os.retention_wait.v4';
const LEGACY_RETENTION_TIMER_JOURNAL_SCHEMA =
  'cortex.learning_os.retention_timer_journal.v2';
export const RETENTION_TIMER_JOURNAL_SCHEMA = 'cortex.learning_os.retention_timer_journal.v3';
const LEGACY_RETENTION_TIMER_INSTALLATION_RECEIPT_SCHEMA =
  'cortex.learning_os.retention_timer_installation_receipt.v1';
const OPAQUE_GENERATION_RETENTION_TIMER_INSTALLATION_RECEIPT_SCHEMA =
  'cortex.learning_os.retention_timer_installation_receipt.v2';
export const RETENTION_TIMER_INSTALLATION_RECEIPT_SCHEMA =
  'cortex.learning_os.retention_timer_installation_receipt.v3';
export const RETENTION_TIMER_MANAGER_FIRING_RECEIPT_SCHEMA =
  'cortex.learning_os.retention_timer_manager_firing_receipt.v1';
export const RETENTION_TIMER_RELEASE_RECEIPT_SCHEMA =
  'cortex.learning_os.retention_timer_release_receipt.v2';
export const PRODUCTION_MINIMUM_SEPARATION_SECONDS = 7 * 24 * 60 * 60;

const DIGEST = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_ABSOLUTE_PATH = /^\/[A-Za-z0-9._/-]+$/;
const SAFE_COMMAND_ARGUMENT = /^[A-Za-z0-9._:/-]+$/;
const DAY_MS = 86_400_000;
const RETENTION_HELPER_PATHS = Object.freeze({
  busctl: '/usr/bin/busctl',
  flock: '/usr/bin/flock',
  getfacl: '/usr/bin/getfacl',
  git: '/usr/bin/git',
  systemctl: '/usr/bin/systemctl',
});
const FIXED_HELPER_ENVIRONMENT = Object.freeze({
  LANG: 'C',
  LC_ALL: 'C',
  PATH: '/usr/bin:/bin',
  TZ: 'UTC',
});
const RETENTION_IDENTITY_SOURCE_SCHEMA = 'cortex.learning_os.retention_identity_sources.v2';
const RETENTION_IDENTITY_SOURCE_PATHS = Object.freeze({
  nsswitch: '/etc/nsswitch.conf',
  passwd: '/etc/passwd',
  group: '/etc/group',
});
const RETENTION_RUNTIME_EXTERNAL_PATHS = Object.freeze({
  machineId: '/etc/machine-id',
  systemBus: '/run/dbus/system_bus_socket',
});
const RETENTION_DURABLE_UNIT_DIRECTORY = '/etc/systemd/system';
const RETENTION_DURABLE_UNIT_READ_FLAGS = fs.constants.O_RDONLY
  | (fs.constants.O_NOFOLLOW || 0)
  | (fs.constants.O_NONBLOCK || 0)
  | (fs.constants.O_CLOEXEC || 0);
const RETENTION_PROTECTED_STATE_READ_FLAGS = fs.constants.O_RDONLY
  | (fs.constants.O_NOFOLLOW || 0)
  | (fs.constants.O_NONBLOCK || 0)
  | (fs.constants.O_CLOEXEC || 0);
const RETENTION_PROTECTED_STATE_DIRECTORY_FLAGS = fs.constants.O_RDONLY
  | (fs.constants.O_DIRECTORY || 0)
  | (fs.constants.O_NOFOLLOW || 0)
  | (fs.constants.O_CLOEXEC || 0);
const RETENTION_PROTECTED_STATE_MAX_BYTES = 1024 * 1024;
const RETENTION_IDENTITY_SOURCE_MAX_BYTES = 16 * 1024 * 1024;
const RETENTION_FIXTURE_EXECUTION_FILE_MAX_BYTES = 256 * 1024 * 1024;
const INJECTED_RETENTION_CRASH = Symbol('injected-retention-crash');
const TIMER_INSTALL_REPAIR_RETRY = Symbol('timer-install-repair-retry');

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertFixtureOnlyBoolean(fixtureOnly, label = 'retention fixtureOnly') {
  if (typeof fixtureOnly !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
}

function exactKeys(value, expected) {
  return isRecord(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort());
}

function canonicalBase64(value, { allowEmpty = false } = {}) {
  if (allowEmpty && value === '') return Buffer.alloc(0);
  if (typeof value !== 'string' || value.length < 4 || value.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, 'base64');
  return bytes.length > 0 && bytes.toString('base64') === value ? bytes : null;
}

function unsigned(value) {
  const { controlPlaneSignature: _signature, ...payload } = value;
  return payload;
}

function keyId(secret) {
  return sha256Text(secret).slice(0, 16);
}

function sign(payload, secret) {
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 4096) {
    throw new Error('retention control-plane secret is invalid');
  }
  return {
    ...payload,
    controlPlaneSignature: {
      algorithm: 'hmac-sha256',
      keyId: keyId(secret),
      digest: crypto.createHmac('sha256', secret).update(canonicalJson(payload)).digest('hex'),
    },
  };
}

function verifySignature(record, secret) {
  const signature = record?.controlPlaneSignature;
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 4096
      || signature?.algorithm !== 'hmac-sha256'
      || signature.keyId !== keyId(secret)
      || !DIGEST.test(String(signature.digest || ''))) return false;
  const expected = crypto.createHmac('sha256', secret).update(canonicalJson(unsigned(record))).digest();
  const actual = Buffer.from(signature.digest, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function validSignatureEnvelope(signature) {
  return isRecord(signature)
    && Object.keys(signature).sort().join(',') === 'algorithm,digest,keyId'
    && signature.algorithm === 'hmac-sha256'
    && /^[0-9a-f]{16}$/.test(String(signature.keyId || ''))
    && DIGEST.test(String(signature.digest || ''));
}

function digestRecord(record) {
  return sha256Text(canonicalJson(record));
}

function policyDigest(policy) {
  return sha256Text(canonicalJson(policy));
}

function positiveUsage(usage) {
  return isRecord(usage)
    && Object.entries(usage).some(([key, value]) => /(?:input|output|total|token)/i.test(key)
      && Number.isFinite(Number(value)) && Number(value) > 0);
}

function timestamp(value, label) {
  const milliseconds = Date.parse(String(value || ''));
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} must be an ISO timestamp`);
  return milliseconds;
}

function controlPlaneTimestamp(value, label, { fixtureOnly, maximumClockSkewSeconds }) {
  const milliseconds = timestamp(value, label);
  if (!fixtureOnly
      && Math.abs(Date.now() - milliseconds) > maximumClockSkewSeconds * 1000) {
    throw new Error(`${label} is backdated or outside the production control-plane clock`);
  }
  return milliseconds;
}

export function validateRetentionPolicy(policy, { fixtureOnly = false } = {}) {
  const errors = [];
  if (typeof fixtureOnly !== 'boolean') {
    return { ok: false, errors: ['retention fixtureOnly must be a boolean'] };
  }
  if (policy?.schemaVersion !== 'cortex.learning_os.retention_policy.v1') errors.push('invalid retention policy schemaVersion');
  if (!IDENTIFIER.test(String(policy?.policyId || ''))) errors.push('invalid retention policyId');
  if (!IDENTIFIER.test(String(policy?.curriculumId || ''))
      || !IDENTIFIER.test(String(policy?.capsuleId || ''))) {
    errors.push('invalid retention curriculum or capsule scope');
  }
  if (policy?.requiredWindows !== 2) errors.push('retention requires exactly two windows');
  if (!Number.isInteger(policy?.minimumSeparationSeconds)
      || policy.minimumSeparationSeconds < (fixtureOnly ? 1 : PRODUCTION_MINIMUM_SEPARATION_SECONDS)) {
    errors.push('retention minimum separation is below the allowed floor');
  }
  if (fixtureOnly && policy?.production !== false) errors.push('fixture retention policy must declare production false');
  if (!fixtureOnly && policy?.production !== true) errors.push('production retention policy must declare production true');
  if (!Number.isInteger(policy?.maximumClockSkewSeconds)
      || policy.maximumClockSkewSeconds < 0 || policy.maximumClockSkewSeconds > 300) {
    errors.push('invalid retention clock skew');
  }
  if (!Number.isInteger(policy?.minimumItemsPerWindow) || policy.minimumItemsPerWindow < 4) {
    errors.push('retention item floor is too low');
  }
  if (!Number.isFinite(policy?.minimumScore) || policy.minimumScore < 0.5 || policy.minimumScore > 1) {
    errors.push('invalid retention score threshold');
  }
  if (!Number.isInteger(policy?.minimumStageCoverage) || policy.minimumStageCoverage < 3) {
    errors.push('retention stage coverage is too narrow');
  }
  if (!Number.isInteger(policy?.minimumTrackCoverage) || policy.minimumTrackCoverage < 8) {
    errors.push('retention track coverage is too narrow');
  }
  const runtime = policy?.modelRuntime;
  if (runtime?.provider !== 'openai-codex'
      || runtime?.thinking !== 'xhigh'
      || runtime?.sandbox !== 'read-only'
      || runtime?.toolsAllowed !== false
      || typeof runtime?.model !== 'string' || runtime.model.length < 1) {
    errors.push('retention runtime must be the exact xhigh no-tools Codex path');
  }
  const independence = policy?.independence;
  if (independence?.distinctSessionPerWindow !== true
      || independence?.disjointItemIds !== true
      || independence?.disjointTheoremIds !== true
      || independence?.previousWindowDigestRequired !== true) {
    errors.push('retention independence policy is incomplete');
  }
  return { ok: errors.length === 0, errors };
}

function validateAcquisitionBinding(binding) {
  return isRecord(binding)
    && Object.keys(binding).sort().join(',')
      === 'completedAt,curriculumId,policyDigest,stateDigest,stateRevision,subjectId'
    && IDENTIFIER.test(String(binding.subjectId || ''))
    && IDENTIFIER.test(String(binding.curriculumId || ''))
    && DIGEST.test(String(binding.policyDigest || ''))
    && Number.isSafeInteger(binding.stateRevision) && binding.stateRevision >= 0
    && DIGEST.test(String(binding.stateDigest || ''))
    && Number.isFinite(Date.parse(String(binding.completedAt || '')));
}

function validateProgramBinding(programDigests, deployment) {
  return isRecord(programDigests)
    && Object.keys(programDigests).sort().join(',') === 'blueprint,graph,rubric'
    && Object.values(programDigests).every((value) => DIGEST.test(String(value)))
    && programDigests.graph === deployment?.contentDigests?.graph
    && programDigests.rubric === deployment?.contentDigests?.rubric
    && programDigests.blueprint === deployment?.contentDigests?.blueprint;
}

function assertGraphRubricBytes(graph, rubric, programDigests) {
  if (sha256Text(canonicalJson(graph)) !== programDigests?.graph
      || sha256Text(canonicalJson(rubric)) !== programDigests?.rubric) {
    throw new Error('retention graph or rubric bytes do not match the signed program');
  }
}

function itemDescriptor(item, {
  graph,
  rubric,
  fixtureOnly,
  trustPolicy,
  deployment,
  campaignBinding,
  assessmentBank,
} = {}) {
  const independent = item?.schemaVersion === INDEPENDENT_ASSESSMENT_ITEM_SCHEMA;
  if (independent) {
    const validator = fixtureOnly
      ? validateIndependentAssessmentFixtureItem
      : validateIndependentAssessmentItem;
    const validation = validator(item, {
      graph,
      rubric,
      trustPolicy,
      deployment,
      campaignBinding,
    });
    if (!validation.ok) {
      throw new Error(`invalid independent retention item: ${validation.errors.join('; ')}`);
    }
  } else {
    replayGeneratedExercise(item);
    if (!fixtureOnly) {
      throw new Error('synthetic generated exercises are fixture-only and forbidden in production retention');
    }
  }
  const conceptId = independent ? item.conceptId : item.generation.conceptId;
  const mapping = rubric?.conceptMappings?.find((row) => row.conceptId === conceptId);
  const concept = graph?.concepts?.find((row) => row.conceptId === conceptId);
  if (!mapping || !concept || !Array.isArray(concept.outcomes) || concept.outcomes.length < 1) {
    throw new Error(`retention concept is not bound to the signed graph/rubric: ${conceptId}`);
  }
  const semanticFamilyId = independent
    ? item.semanticFamilyId
    : item.generation.theoremFamilyId || item.generation.family;
  return {
    itemId: item.itemId,
    theoremId: `theorem:${semanticFamilyId}`,
    semanticFamilyId,
    conceptId,
    outcomeIds: independent
      ? structuredClone(item.outcomeIds)
      : concept.outcomes.map((outcome) => `outcome:${sha256Text(outcome)}`),
    stage: independent ? item.stage : mapping.stage,
    tracks: structuredClone(independent ? item.trackIds : mapping.tracks),
    promptSha256: independent ? item.contentSha256 : sha256Text(item.prompt),
    itemSha256: sha256Text(canonicalJson(item)),
    checkerSha256: independent
      ? item.checker.specificationSha256
      : sha256Text(canonicalJson(item.checker)),
    assessmentBankId: assessmentBank?.bankId || null,
  };
}

function resolveRetentionBank({
  assessmentBank,
  sealedItems,
  graph,
  rubric,
  trustPolicy,
  deployment,
  campaignBinding = undefined,
  fixtureOnly,
} = {}) {
  if (assessmentBank !== null && assessmentBank !== undefined) {
    if (sealedItems !== null && sealedItems !== undefined) {
      throw new Error('retention accepts either an independent assessment bank or fixture sealedItems, not both');
    }
    const validator = fixtureOnly
      ? validateIndependentAssessmentFixtureBank
      : validateIndependentAssessmentBank;
    const validation = validator(assessmentBank, {
      graph,
      rubric,
      trustPolicy,
      deployment,
      campaignBinding: campaignBinding ?? assessmentBank?.bindings?.campaign,
    });
    if (!validation.ok || assessmentBank.purpose !== 'retention') {
      throw new Error(`invalid independent retention assessment bank: ${validation.errors.join('; ')}`);
    }
    return {
      items: assessmentBank.items,
      digest: assessmentBank.bankDigest,
      recordDigest: digestRecord(assessmentBank),
      bankId: assessmentBank.bankId,
      campaignBinding: assessmentBank.bindings.campaign,
      assessmentBank,
    };
  }
  if (!fixtureOnly) {
    if (Array.isArray(sealedItems)) {
      throw new Error('synthetic generated exercises are fixture-only and forbidden in production retention');
    }
    throw new Error('production retention requires an external independently authored assessment bank');
  }
  if (!Array.isArray(sealedItems)) throw new Error('fixture retention sealed item bank is incomplete');
  return {
    items: sealedItems,
    digest: sha256Text(canonicalJson(sealedItems)),
    recordDigest: null,
    bankId: null,
    campaignBinding: null,
    assessmentBank: null,
  };
}

function validateItemCoverage(descriptors, policy) {
  if (!Array.isArray(descriptors) || descriptors.length < policy.minimumItemsPerWindow) {
    throw new Error('retention window has too few assessment items');
  }
  for (const field of ['itemId', 'theoremId', 'conceptId']) {
    if (new Set(descriptors.map((item) => item[field])).size !== descriptors.length) {
      throw new Error(`retention window reuses ${field}`);
    }
  }
  if (new Set(descriptors.map((item) => item.stage)).size < policy.minimumStageCoverage) {
    throw new Error('retention window stage coverage is too narrow');
  }
  const tracks = new Set(descriptors.flatMap((item) => item.tracks));
  if (tracks.size < policy.minimumTrackCoverage) {
    throw new Error('retention window track coverage is too narrow');
  }
}

export function buildRetentionWindowTask({
  taskId,
  subjectId,
  windowIndex,
  deployment,
  programDigests,
  policy,
  acquisitionBinding,
  sealedItems = null,
  assessmentBank = null,
  itemMappings = undefined,
  graph,
  rubric,
  trustPolicy,
  campaignBinding = null,
  issuedAt,
  previousWindow = null,
  signingSecret,
  fixtureOnly = false,
} = {}) {
  assertFixtureOnlyBoolean(fixtureOnly);
  if (itemMappings !== undefined) {
    throw new Error('caller-supplied retention stage or track mappings are forbidden');
  }
  const policyValidation = validateRetentionPolicy(policy, { fixtureOnly });
  if (!policyValidation.ok) throw new Error(`invalid retention policy: ${policyValidation.errors.join('; ')}`);
  if (!fixtureOnly
      && policyDigest(policy) !== deployment?.contentDigests?.['retention-policy']) {
    throw new Error('retention policy bytes do not match the deployed retention policy');
  }
  const deploymentValidation = validateDeploymentBinding(deployment, {
    requiredContentIds: ['graph', 'rubric', 'blueprint', 'acquisition-policy', 'retention-policy', 'trust-policy'],
  });
  if (!deploymentValidation.ok) throw new Error(`invalid retention deployment: ${deploymentValidation.errors.join('; ')}`);
  if (!IDENTIFIER.test(String(taskId || '')) || !IDENTIFIER.test(String(subjectId || ''))) {
    throw new Error('invalid retention task or subject identity');
  }
  if (!Number.isInteger(windowIndex) || windowIndex < 1 || windowIndex > policy.requiredWindows) {
    throw new Error('invalid retention window index');
  }
  if (!validateAcquisitionBinding(acquisitionBinding)) throw new Error('invalid acquisition binding');
  if (acquisitionBinding.subjectId !== subjectId
      || acquisitionBinding.curriculumId !== policy.curriculumId
      || acquisitionBinding.policyDigest !== deployment.contentDigests['acquisition-policy']) {
    throw new Error('retention acquisition subject, curriculum, or policy binding mismatch');
  }
  if (!validateProgramBinding(programDigests, deployment)) {
    throw new Error('retention program digests do not match the deployed graph, rubric, and blueprint');
  }
  assertGraphRubricBytes(graph, rubric, programDigests);
  if (!fixtureOnly && (assessmentBank === null || assessmentBank === undefined)) {
    if (Array.isArray(sealedItems)) {
      throw new Error('synthetic generated exercises are fixture-only and forbidden in production retention');
    }
    throw new Error('production retention requires an external independently authored assessment bank');
  }
  const trustValidation = validatePhdTrustPolicy(trustPolicy, { requireProduction: !fixtureOnly });
  if (!trustValidation.ok
      || sha256Text(canonicalJson(trustPolicy)) !== deployment.contentDigests['trust-policy']) {
    throw new Error(`retention trust policy is invalid: ${trustValidation.errors.join('; ')}`);
  }
  const bank = resolveRetentionBank({
    assessmentBank,
    sealedItems,
    graph,
    rubric,
    trustPolicy,
    deployment,
    campaignBinding: fixtureOnly ? undefined : campaignBinding,
    fixtureOnly,
  });
  const descriptors = bank.items.map((item) => itemDescriptor(item, {
    graph,
    rubric,
    trustPolicy,
    deployment,
    campaignBinding: bank.campaignBinding,
    assessmentBank: bank.assessmentBank,
    fixtureOnly,
  }));
  validateItemCoverage(descriptors, policy);
  const issuedAtMs = controlPlaneTimestamp(issuedAt, 'retention issuedAt', {
    fixtureOnly,
    maximumClockSkewSeconds: policy.maximumClockSkewSeconds,
  });
  const acquisitionMs = timestamp(acquisitionBinding.completedAt, 'acquisition completedAt');
  if (issuedAtMs < acquisitionMs) throw new Error('retention task was issued before acquisition completed');
  let earliestMs = acquisitionMs;
  let previousWindowDigest = null;
  if (windowIndex > 1) {
    if (!previousWindow || previousWindow.schemaVersion !== RETENTION_EVIDENCE_SCHEMA
        || !verifySignature(previousWindow, signingSecret)
        || previousWindow.subjectId !== subjectId
        || previousWindow.windowIndex !== windowIndex - 1
        || previousWindow.status !== 'passed') {
      throw new Error('retention previous window is missing, invalid, or failed');
    }
    earliestMs = timestamp(previousWindow.completedAt, 'previous retention completion')
      + policy.minimumSeparationSeconds * 1000;
    previousWindowDigest = digestRecord(previousWindow);
    const oldItems = new Set(previousWindow.items.map((item) => item.itemId));
    const oldTheorems = new Set(previousWindow.items.map((item) => item.theoremId));
    const oldFamilies = new Set(previousWindow.items.map((item) => item.semanticFamilyId));
    const oldConcepts = new Set(previousWindow.items.map((item) => item.conceptId));
    const oldOutcomes = new Set(previousWindow.items.flatMap((item) => item.outcomeIds));
    if (descriptors.some((item) => oldItems.has(item.itemId)
      || oldTheorems.has(item.theoremId)
      || oldFamilies.has(item.semanticFamilyId)
      || oldConcepts.has(item.conceptId)
      || item.outcomeIds.some((outcomeId) => oldOutcomes.has(outcomeId)))) {
      throw new Error('retention windows overlap item, concept, outcome, or semantic theorem family');
    }
  }
  const notBeforeMs = Math.max(issuedAtMs, earliestMs);
  const promptCommitment = {
    taskId,
    subjectId,
    windowIndex,
    fixtureOnly,
    descriptors,
    sealedItemBankSha256: bank.digest,
    assessmentBankRecordDigest: bank.recordDigest,
    assessmentBankId: bank.bankId,
    assessmentCampaign: bank.campaignBinding,
    issuedAt,
  };
  const payload = {
    schemaVersion: RETENTION_TASK_SCHEMA,
    taskId,
    subjectId,
    windowIndex,
    fixtureOnly,
    declaredUnseen: true,
    deployment,
    deploymentDigest: deploymentBindingDigest(deployment),
    programDigests,
    policyId: policy.policyId,
    policyDigest: policyDigest(policy),
    acquisitionBinding,
    issuedAt,
    notBefore: new Date(notBeforeMs).toISOString(),
    expiresAt: new Date(notBeforeMs + 24 * 60 * 60 * 1000).toISOString(),
    promptCommitmentDigest: sha256Text(canonicalJson(promptCommitment)),
    sealedItemBankDigest: promptCommitment.sealedItemBankSha256,
    assessmentBankRecordDigest: bank.recordDigest,
    assessmentBankId: bank.bankId,
    assessmentCampaign: bank.campaignBinding,
    items: descriptors,
    previousWindowDigest,
    runtime: structuredClone(policy.modelRuntime),
    trustPolicyDigest: sha256Text(canonicalJson(trustPolicy)),
    truthBoundary: 'This signed task authorizes one declared-unseen retention assessment. It is not acquisition practice or routine review scheduling.',
  };
  return sign(payload, signingSecret);
}

function assertTask(task, { policy, deployment, trustPolicy, signingSecret, fixtureOnly }) {
  const policyValidation = validateRetentionPolicy(policy, { fixtureOnly });
  if (!policyValidation.ok) throw new Error(`invalid retention policy: ${policyValidation.errors.join('; ')}`);
  if (task?.schemaVersion !== RETENTION_TASK_SCHEMA || !verifySignature(task, signingSecret)) {
    throw new Error('retention task signature mismatch');
  }
  assertDeploymentBinding(task.deployment, deployment, {
    requiredContentIds: ['graph', 'rubric', 'blueprint', 'acquisition-policy', 'retention-policy', 'trust-policy'],
  });
  if (task.deploymentDigest !== deploymentBindingDigest(deployment)
      || task.policyId !== policy.policyId
      || task.policyDigest !== policyDigest(policy)
      || (!fixtureOnly
        && task.policyDigest !== deployment.contentDigests['retention-policy'])
      || task.trustPolicyDigest !== sha256Text(canonicalJson(trustPolicy))
      || task.trustPolicyDigest !== deployment.contentDigests['trust-policy']
      || task.declaredUnseen !== true
      || task.fixtureOnly !== fixtureOnly
      || !validateProgramBinding(task.programDigests, deployment)
      || !validateAcquisitionBinding(task.acquisitionBinding)
      || task.acquisitionBinding.subjectId !== task.subjectId
      || task.acquisitionBinding.curriculumId !== policy.curriculumId
      || task.acquisitionBinding.policyDigest !== deployment.contentDigests['acquisition-policy']
      || canonicalJson(task.runtime) !== canonicalJson(policy.modelRuntime)) {
    throw new Error('retention task policy, runtime, or deployment drift');
  }
}

function retentionReleaseRecord({ task, bank, releasedAt, fixtureOnly }) {
  return {
    schemaVersion: RETENTION_RELEASE_SCHEMA,
    taskId: task.taskId,
    subjectId: task.subjectId,
    windowIndex: task.windowIndex,
    fixtureOnly,
    releasedAt,
    taskDigest: digestRecord(task),
    promptCommitmentDigest: task.promptCommitmentDigest,
    items: bank.items.map((item) => {
      const materialized = item.schemaVersion === INDEPENDENT_ASSESSMENT_ITEM_SCHEMA
        ? materializeIndependentAssessmentItem(item, { bank: bank.assessmentBank })
        : item;
      return {
        itemId: materialized.itemId,
        prompt: materialized.prompt,
        answerFormat: materialized.answerFormat,
      };
    }),
    truthBoundary: 'Candidate-visible release bytes omit checkers, answers, and grading thresholds.',
  };
}

export function validateRetentionExecutionAuthorization({
  task,
  release,
  signingSecret,
} = {}) {
  const errors = [];
  const taskKeys = [
    'schemaVersion', 'taskId', 'subjectId', 'windowIndex', 'fixtureOnly',
    'declaredUnseen', 'deployment', 'deploymentDigest', 'programDigests',
    'policyId', 'policyDigest', 'acquisitionBinding', 'issuedAt', 'notBefore',
    'expiresAt', 'promptCommitmentDigest', 'sealedItemBankDigest',
    'assessmentBankRecordDigest', 'assessmentBankId', 'assessmentCampaign',
    'items', 'previousWindowDigest', 'runtime', 'trustPolicyDigest',
    'truthBoundary', 'controlPlaneSignature',
  ];
  const releaseKeys = [
    'schemaVersion', 'taskId', 'subjectId', 'windowIndex', 'fixtureOnly',
    'releasedAt', 'taskDigest', 'promptCommitmentDigest', 'items',
    'truthBoundary',
  ];
  if (!exactKeys(task, taskKeys)
      || task?.schemaVersion !== RETENTION_TASK_SCHEMA
      || !verifySignature(task, signingSecret)) {
    return { ok: false, errors: ['retention execution task signature or fields are invalid'] };
  }
  const deployment = validateDeploymentBinding(task.deployment);
  errors.push(...deployment.errors.map((error) => `retention execution deployment: ${error}`));
  const issuedAtMs = Date.parse(String(task.issuedAt || ''));
  const notBeforeMs = Date.parse(String(task.notBefore || ''));
  const expiresAtMs = Date.parse(String(task.expiresAt || ''));
  const releasedAtMs = Date.parse(String(release?.releasedAt || ''));
  const exactTimestamp = (value, milliseconds) => Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === value;
  if (!IDENTIFIER.test(String(task.taskId || ''))
      || !IDENTIFIER.test(String(task.subjectId || ''))
      || !Number.isInteger(task.windowIndex) || task.windowIndex < 1
      || task.fixtureOnly !== false
      || task.declaredUnseen !== true
      || !deployment.ok
      || task.deployment?.schemaVersion !== FROZEN_DEPLOYMENT_BINDING_SCHEMA
      || task.deployment?.executionClosure?.immutable !== true
      || task.deploymentDigest !== (deployment.ok
        ? deploymentBindingDigest(task.deployment)
        : null)
      || !DIGEST.test(String(task.policyDigest || ''))
      || !DIGEST.test(String(task.promptCommitmentDigest || ''))
      || !DIGEST.test(String(task.sealedItemBankDigest || ''))
      || !DIGEST.test(String(task.assessmentBankRecordDigest || ''))
      || !DIGEST.test(String(task.trustPolicyDigest || ''))
      || !exactKeys(task.assessmentCampaign, ['campaignId', 'campaignDigest'])
      || !IDENTIFIER.test(String(task.assessmentCampaign?.campaignId || ''))
      || !DIGEST.test(String(task.assessmentCampaign?.campaignDigest || ''))
      || task.taskId !== `${task.assessmentCampaign?.campaignId}.retention.${task.windowIndex}`
      || !exactTimestamp(task.issuedAt, issuedAtMs)
      || !exactTimestamp(task.notBefore, notBeforeMs)
      || !exactTimestamp(task.expiresAt, expiresAtMs)
      || notBeforeMs < issuedAtMs
      || expiresAtMs - notBeforeMs !== DAY_MS
      || !exactKeys(task.runtime, ['provider', 'model', 'thinking', 'sandbox', 'toolsAllowed'])
      || task.runtime?.provider !== 'openai-codex'
      || typeof task.runtime?.model !== 'string' || task.runtime.model.length < 1
      || task.runtime?.thinking !== 'xhigh'
      || task.runtime?.sandbox !== 'read-only'
      || task.runtime?.toolsAllowed !== false
      || (task.previousWindowDigest !== null
        && !DIGEST.test(String(task.previousWindowDigest || '')))
      || !Array.isArray(task.items) || task.items.length < 1
      || new Set(task.items.map((item) => item?.itemId)).size !== task.items.length) {
    errors.push('retention execution task identity, timing, runtime, or item set is invalid');
  }
  if (!exactKeys(release, releaseKeys)
      || release?.schemaVersion !== RETENTION_RELEASE_SCHEMA
      || release.fixtureOnly !== false
      || release.taskId !== task.taskId
      || release.subjectId !== task.subjectId
      || release.windowIndex !== task.windowIndex
      || release.taskDigest !== digestRecord(task)
      || release.promptCommitmentDigest !== task.promptCommitmentDigest
      || !exactTimestamp(release.releasedAt, releasedAtMs)
      || releasedAtMs < notBeforeMs || releasedAtMs > expiresAtMs
      || !Array.isArray(release.items)
      || release.items.length !== task.items.length
      || new Set(release.items.map((item) => item?.itemId)).size !== release.items.length) {
    errors.push('retention execution release identity, timing, or item set is invalid');
  } else {
    for (const [index, releasedItem] of release.items.entries()) {
      const descriptor = task.items[index];
      if (!exactKeys(releasedItem, ['itemId', 'prompt', 'answerFormat'])
          || releasedItem.itemId !== descriptor?.itemId
          || typeof releasedItem.prompt !== 'string' || releasedItem.prompt.length < 1
          || sha256Text(releasedItem.prompt) !== descriptor?.promptSha256) {
        errors.push(`retention execution release item ${index + 1} differs from the signed task`);
      }
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    campaignId: task.assessmentCampaign?.campaignId || null,
    campaignDigest: task.assessmentCampaign?.campaignDigest || null,
    subjectId: task.subjectId,
    taskDigest: digestRecord(task),
    releaseDigest: isRecord(release) ? digestRecord(release) : null,
  };
}

export function atomicWriteRetentionRelease(targetPath, release, {
  task,
  signingSecret,
} = {}) {
  const expected = canonicalJson(release);
  const authenticate = (candidate) => canonicalJson(candidate) === expected
    && validateRetentionExecutionAuthorization({
      task,
      release: candidate,
      signingSecret,
    }).ok;
  if (!authenticate(release)) {
    throw new Error('refusing to publish an unauthorized retention release');
  }
  return atomicWriteAuthenticatedJson(targetPath, release, { authenticate });
}

export function buildRetentionWorkerPrompt(release) {
  assertFixtureOnlyBoolean(release?.fixtureOnly, 'retention release fixtureOnly');
  if (release?.schemaVersion !== RETENTION_RELEASE_SCHEMA) {
    throw new Error('retention worker prompt requires an exact candidate release');
  }
  return [
    'Complete this exact declared-unseen retention release without tools.',
    'Return only JSON matching {"answers":[{"itemId":"...","answer":"..."}]}; answer every item exactly once.',
    canonicalJson(release),
  ].join('\n\n');
}

function releaseRetentionWindowInternal({
  task,
  sealedItems = null,
  assessmentBank = null,
  graph,
  rubric,
  policy,
  deployment,
  trustPolicy,
  signingSecret,
  now,
  fixtureOnly = false,
} = {}, {
  reconciledTimerFiring = false,
} = {}) {
  assertFixtureOnlyBoolean(fixtureOnly, 'retention release fixtureOnly');
  assertTask(task, { policy, deployment, trustPolicy, signingSecret, fixtureOnly });
  assertGraphRubricBytes(graph, rubric, task.programDigests);
  const nowMs = reconciledTimerFiring
    ? timestamp(now, 'authenticated retention timer firing time')
    : controlPlaneTimestamp(now, 'retention release time', {
      fixtureOnly,
      maximumClockSkewSeconds: policy.maximumClockSkewSeconds,
    });
  if (nowMs < timestamp(task.notBefore, 'retention notBefore')) throw new Error('retention window is not eligible yet');
  if (nowMs > timestamp(task.expiresAt, 'retention expiresAt')) throw new Error('retention task expired');
  const bank = resolveRetentionBank({
    assessmentBank,
    sealedItems,
    graph,
    rubric,
    trustPolicy,
    deployment,
    campaignBinding: fixtureOnly ? undefined : task.assessmentCampaign,
    fixtureOnly,
  });
  if (bank.digest !== task.sealedItemBankDigest
      || bank.recordDigest !== task.assessmentBankRecordDigest
      || bank.bankId !== task.assessmentBankId
      || canonicalJson(bank.campaignBinding) !== canonicalJson(task.assessmentCampaign)) {
    throw new Error('retention sealed item bank digest mismatch');
  }
  const descriptors = bank.items.map((item) => itemDescriptor(item, {
    graph,
    rubric,
    trustPolicy,
    deployment,
    campaignBinding: bank.campaignBinding,
    assessmentBank: bank.assessmentBank,
    fixtureOnly,
  }));
  if (canonicalJson(descriptors) !== canonicalJson(task.items)) throw new Error('retention item descriptor substitution');
  return retentionReleaseRecord({ task, bank, releasedAt: now, fixtureOnly });
}

export function releaseRetentionWindow(options = {}) {
  assertFixtureOnlyBoolean(
    Object.hasOwn(options, 'fixtureOnly') ? options.fixtureOnly : false,
  );
  return releaseRetentionWindowInternal(options);
}

export function gradeRetentionWindow({
  task,
  release = null,
  sealedItems = null,
  assessmentBank = null,
  graph,
  rubric,
  attempt,
  policy,
  deployment,
  executionDeployment = null,
  trustPolicy,
  signingSecret,
  now,
  previousWindow = null,
  fixtureOnly = false,
  qualificationHarvestBinding = null,
  harvestedWorkerCall = null,
} = {}) {
  assertFixtureOnlyBoolean(fixtureOnly);
  assertTask(task, { policy, deployment, trustPolicy, signingSecret, fixtureOnly });
  const trustedExecutionDeployment = executionDeployment || deployment;
  if (!fixtureOnly) {
    assertRetentionExecutionDeployment(
      trustedExecutionDeployment,
      task.deployment,
    );
  }
  assertGraphRubricBytes(graph, rubric, task.programDigests);
  if (!isRecord(attempt) || attempt.taskId !== task.taskId || attempt.subjectId !== task.subjectId) {
    throw new Error('retention attempt task or subject mismatch');
  }
  const bank = resolveRetentionBank({
    assessmentBank,
    sealedItems,
    graph,
    rubric,
    trustPolicy,
    deployment,
    campaignBinding: fixtureOnly ? undefined : task.assessmentCampaign,
    fixtureOnly,
  });
  if (bank.digest !== task.sealedItemBankDigest
      || bank.recordDigest !== task.assessmentBankRecordDigest
      || bank.bankId !== task.assessmentBankId
      || canonicalJson(bank.campaignBinding) !== canonicalJson(task.assessmentCampaign)) {
    throw new Error('retention item bank substitution');
  }
  const nowMs = controlPlaneTimestamp(now, 'retention harvest time', {
    fixtureOnly,
    maximumClockSkewSeconds: policy.maximumClockSkewSeconds,
  });
  let workerPromptSha256 = null;
  let workerPromptBytes = null;
  if (!fixtureOnly) {
    if (!isRecord(qualificationHarvestBinding)
        || !DIGEST.test(String(qualificationHarvestBinding.planDigest || ''))
        || !DIGEST.test(String(qualificationHarvestBinding.harvestStateDigest || ''))
        || !DIGEST.test(String(qualificationHarvestBinding.receiptSetSha256 || ''))
        || !DIGEST.test(String(qualificationHarvestBinding.artifactSetSha256 || ''))) {
      throw new Error('retention grading requires the exact authenticated qualification harvest');
    }
    if (!isRecord(harvestedWorkerCall)
        || canonicalJson(attempt?.executionEvidenceCore)
          !== canonicalJson(harvestedWorkerCall.executionEvidenceCore)
        || attempt?.executionEvidenceSha256
          !== harvestedWorkerCall.executionEvidenceSha256) {
      throw new Error('retention execution differs from the exact harvested model-call.json');
    }
    const expectedRelease = retentionReleaseRecord({
      task,
      bank,
      releasedAt: release?.releasedAt,
      fixtureOnly,
    });
    if (canonicalJson(release) !== canonicalJson(expectedRelease)) {
      throw new Error('retention candidate release bytes were omitted or substituted');
    }
    workerPromptBytes = Buffer.from(buildRetentionWorkerPrompt(expectedRelease), 'utf8');
    workerPromptSha256 = sha256Text(workerPromptBytes);
  }
  const startedAtMs = timestamp(attempt.startedAt, 'retention startedAt');
  const completedAtMs = timestamp(attempt.completedAt, 'retention completedAt');
  const skewMs = policy.maximumClockSkewSeconds * 1000;
  if (startedAtMs < timestamp(task.notBefore, 'retention notBefore')
      || completedAtMs < startedAtMs
      || completedAtMs > nowMs + skewMs
      || nowMs - completedAtMs > skewMs
      || completedAtMs > timestamp(task.expiresAt, 'retention expiresAt')) {
    throw new Error('retention interval compression, backdating, or timestamp drift');
  }
  if (attempt.provider !== policy.modelRuntime.provider
      || attempt.model !== policy.modelRuntime.model
      || attempt.thinking !== 'xhigh'
      || attempt.sandbox !== 'read-only'
      || attempt.toolsAllowed !== false
      || !Array.isArray(attempt.toolsUsed) || attempt.toolsUsed.length !== 0
      || !positiveUsage(attempt.usage)
      || !IDENTIFIER.test(String(attempt.sessionId || ''))) {
    throw new Error('retention provider usage, xhigh identity, no-tools, or session evidence is invalid');
  }
  let trustedExecution = null;
  if (!fixtureOnly) {
    const rawOutput = Buffer.from(attempt.rawOutputBase64 || '', 'base64');
    let parsed;
    try { parsed = JSON.parse(rawOutput.toString('utf8')); } catch { parsed = null; }
    trustedExecution = verifyTrustedExecutionEvidence({
      attestation: attempt.executionAttestation,
      trustPolicy,
      executionEvidenceCore: attempt.executionEvidenceCore,
      executionEvidenceSha256: attempt.executionEvidenceSha256,
      inputBytes: workerPromptBytes,
      rawOutputBytes: rawOutput,
      rawEventLedgerBytes: Buffer.from(attempt.rawEventLedgerBase64 || '', 'base64'),
      rawStderrBytes: Buffer.from(attempt.rawStderrBase64 || '', 'base64'),
      expected: {
        provider: policy.modelRuntime.provider,
        model: policy.modelRuntime.model,
        role: 'retention',
        plannedSessionId: attempt.sessionId,
        promptSha256: workerPromptSha256,
        bindings: {
          candidateId: task.subjectId,
          candidateSessionId: attempt.sessionId,
          candidateSha256: sha256Bytes(rawOutput),
          taskId: task.taskId,
          taskSha256: digestRecord(retentionJobTaskRecord({
            task,
            release,
            executionDeployment: trustedExecutionDeployment,
          })),
          deploymentSha256: deploymentBindingDigest(trustedExecutionDeployment),
          sourceSha256: executionSourceSha256(trustedExecutionDeployment),
        },
        startedAt: attempt.startedAt,
        completedAt: attempt.completedAt,
        notBefore: task.notBefore,
        notAfter: task.expiresAt,
        approvedExecutable: trustedExecutionDeployment.approvedModelExecutable,
        command: harvestedWorkerCall.executionEvidenceCore?.command,
        observedEnvironment: harvestedWorkerCall.executionEvidenceCore?.environment?.observed,
      },
    });
    if (!trustedExecution.ok
        || attempt.provider !== trustedExecution.payload?.provider
        || attempt.model !== trustedExecution.payload?.model
        || canonicalJson(attempt.usage) !== canonicalJson(trustedExecution.payload?.usage)
        || canonicalJson(parsed?.answers) !== canonicalJson(attempt.answers)) {
      throw new Error(`retention trusted raw execution failed: ${[
        ...trustedExecution.errors,
        'answer/output binding mismatch',
      ].join('; ')}`);
    }
  }
  if (task.windowIndex > 1) {
    if (!previousWindow || digestRecord(previousWindow) !== task.previousWindowDigest
        || !verifySignature(previousWindow, signingSecret)
        || previousWindow.sessionId === attempt.sessionId) {
      throw new Error('retention previous-window chain or session independence fraud');
    }
    if (startedAtMs - timestamp(previousWindow.completedAt, 'previous completedAt')
        < policy.minimumSeparationSeconds * 1000) {
      throw new Error('retention interval is compressed');
    }
  }
  if (!Array.isArray(attempt.answers)
      || attempt.answers.length !== bank.items.length
      || new Set(attempt.answers.map((answer) => answer?.itemId)).size !== bank.items.length) {
    throw new Error('retention answer set is partial or duplicated');
  }
  const answerById = new Map(attempt.answers.map((answer) => [answer.itemId, answer.answer]));
  const itemResults = bank.items.map((item, index) => {
    const descriptor = itemDescriptor(item, {
      graph,
      rubric,
      trustPolicy,
      deployment,
      campaignBinding: bank.campaignBinding,
      assessmentBank: bank.assessmentBank,
      fixtureOnly,
    });
    if (canonicalJson(descriptor) !== canonicalJson(task.items[index])) throw new Error('retention item descriptor mismatch');
    if (!answerById.has(item.itemId)) throw new Error('retention answer set omits an item');
    const grading = item.schemaVersion === INDEPENDENT_ASSESSMENT_ITEM_SCHEMA
      ? (fixtureOnly ? executeIndependentAssessmentFixtureItem : executeIndependentAssessmentItem)({
        item,
        answer: answerById.get(item.itemId),
        graph,
        rubric,
        trustPolicy,
        deployment,
        campaignBinding: bank.campaignBinding,
        bank: bank.assessmentBank,
      }).grading
      : verifyGeneratedAnswer({ item, answer: answerById.get(item.itemId) });
    return {
      ...descriptor,
      answerDigest: sha256Text(canonicalJson(answerById.get(item.itemId))),
      graderDigest: sha256Text(canonicalJson({
        checker: item.checker,
        grading,
      })),
      passed: grading.passed === true,
    };
  });
  const passedCount = itemResults.filter((item) => item.passed).length;
  const score = passedCount / itemResults.length;
  const status = score >= policy.minimumScore ? 'passed' : 'failed';
  return sign({
    schemaVersion: RETENTION_EVIDENCE_SCHEMA,
    evidenceId: `retention:${task.subjectId}:w${task.windowIndex}`,
    taskId: task.taskId,
    taskDigest: digestRecord(task),
    subjectId: task.subjectId,
    windowIndex: task.windowIndex,
    fixtureOnly,
    deployment: task.deployment,
    deploymentDigest: task.deploymentDigest,
    programDigests: task.programDigests,
    policyId: task.policyId,
    policyDigest: task.policyDigest,
    acquisitionBinding: task.acquisitionBinding,
    task: structuredClone(task),
    promptCommitmentDigest: task.promptCommitmentDigest,
    release: structuredClone(release),
    workerPromptSha256,
    workerPromptBase64: workerPromptBytes?.toString('base64') || null,
    sealedItemBankDigest: task.sealedItemBankDigest,
    assessmentBankRecordDigest: task.assessmentBankRecordDigest,
    assessmentBankId: task.assessmentBankId,
    assessmentCampaign: task.assessmentCampaign,
    qualificationHarvestBinding: structuredClone(qualificationHarvestBinding),
    previousWindowDigest: task.previousWindowDigest,
    notBefore: task.notBefore,
    expiresAt: task.expiresAt,
    releasedAt: release?.releasedAt ?? null,
    sessionId: attempt.sessionId,
    provider: attempt.provider,
    model: attempt.model,
    thinking: attempt.thinking,
    toolsUsed: [],
    usageDigest: sha256Text(canonicalJson(attempt.usage)),
    startedAt: trustedExecution?.payload?.startedAt || attempt.startedAt,
    completedAt: trustedExecution?.payload?.completedAt || attempt.completedAt,
    executionAttestationDigest: trustedExecution
      ? digestRecord(attempt.executionAttestation)
      : null,
    executionEvidenceSha256: trustedExecution?.executionEvidenceSha256 || null,
    execution: trustedExecution ? {
      jobId: attempt.jobId,
      jobDigest: attempt.jobDigest,
      jobNotBefore: attempt.notBefore,
      jobExpiresAt: attempt.expiresAt,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      executionIntervalSha256: attempt.executionIntervalSha256,
      executionIdentity: structuredClone(attempt.executionIdentity),
      promptSha256: attempt.promptSha256,
      attestation: structuredClone(attempt.executionAttestation),
      executionEvidenceCore: structuredClone(attempt.executionEvidenceCore),
      executionEvidenceSha256: attempt.executionEvidenceSha256,
      rawOutputBase64: attempt.rawOutputBase64,
      rawEventLedgerBase64: attempt.rawEventLedgerBase64,
      rawStderrBase64: attempt.rawStderrBase64,
      outputSha256: sha256Bytes(Buffer.from(attempt.rawOutputBase64 || '', 'base64')),
      rawEventLedgerSha256: sha256Bytes(
        Buffer.from(attempt.rawEventLedgerBase64 || '', 'base64'),
      ),
      rawStderrSha256: sha256Bytes(
        Buffer.from(attempt.rawStderrBase64 || '', 'base64'),
      ),
    } : null,
    harvestedAt: now,
    items: itemResults,
    passedCount,
    itemCount: itemResults.length,
    score,
    threshold: policy.minimumScore,
    status,
    truthBoundary: status === 'passed'
      ? 'This window passed its bounded unseen retention threshold; retained mastery requires the complete two-window signed chain.'
      : 'This window failed. Acquisition coverage is unchanged and no retained-mastery claim is allowed.',
  }, signingSecret);
}

const RETENTION_EVIDENCE_FIELDS = Object.freeze([
  'acquisitionBinding',
  'assessmentBankId',
  'assessmentBankRecordDigest',
  'assessmentCampaign',
  'completedAt',
  'controlPlaneSignature',
  'deployment',
  'deploymentDigest',
  'evidenceId',
  'execution',
  'executionAttestationDigest',
  'executionEvidenceSha256',
  'expiresAt',
  'fixtureOnly',
  'harvestedAt',
  'itemCount',
  'items',
  'model',
  'notBefore',
  'passedCount',
  'policyDigest',
  'policyId',
  'previousWindowDigest',
  'programDigests',
  'promptCommitmentDigest',
  'provider',
  'qualificationHarvestBinding',
  'release',
  'releasedAt',
  'schemaVersion',
  'score',
  'sealedItemBankDigest',
  'sessionId',
  'startedAt',
  'status',
  'subjectId',
  'task',
  'taskDigest',
  'taskId',
  'thinking',
  'threshold',
  'toolsUsed',
  'truthBoundary',
  'usageDigest',
  'windowIndex',
  'workerPromptBase64',
  'workerPromptSha256',
]);

function productionWindowEvidenceErrors({
  window,
  index,
  assessmentBank,
  subjectId,
  policy,
  deployment,
  executionDeployment = null,
  trustPolicy,
  campaignBinding,
  acquisitionBinding,
  graph,
  rubric,
  signingSecret,
  evaluatedAt,
  harvestedWorkerCall = null,
} = {}) {
  const errors = [];
  const label = `window ${index + 1}`;
  const trustedExecutionDeployment = executionDeployment || deployment;
  if (!exactKeys(window, RETENTION_EVIDENCE_FIELDS)
      || window?.schemaVersion !== RETENTION_EVIDENCE_SCHEMA
      || !validSignatureEnvelope(window?.controlPlaneSignature)
      || !verifySignature(window, signingSecret)) {
    return [`${label} fields or signature mismatch`];
  }
  let bank;
  try {
    bank = resolveRetentionBank({
      assessmentBank,
      sealedItems: null,
      graph,
      rubric,
      trustPolicy,
      deployment,
      campaignBinding,
      fixtureOnly: false,
    });
  } catch (error) {
    return [`${label} signed assessment bank is invalid: ${error.message}`];
  }
  try {
    assertDeploymentBinding(window.deployment, deployment, {
      requiredContentIds: [
        'graph', 'rubric', 'blueprint', 'acquisition-policy',
        'retention-policy', 'trust-policy',
      ],
    });
    assertRetentionExecutionDeployment(trustedExecutionDeployment, deployment);
  } catch (error) {
    errors.push(`${label} ${error.message}`);
  }
  try {
    assertTask(window.task, {
      policy,
      deployment,
      trustPolicy,
      signingSecret,
      fixtureOnly: false,
    });
  } catch (error) {
    errors.push(`${label} exact signed task is invalid: ${error.message}`);
  }
  if (window.evidenceId !== `retention:${subjectId}:w${index + 1}`
      || !IDENTIFIER.test(String(window.taskId || ''))
      || !DIGEST.test(String(window.taskDigest || ''))
      || window.taskDigest !== digestRecord(window.task)
      || window.task?.taskId !== window.taskId
      || window.task?.subjectId !== window.subjectId
      || window.task?.windowIndex !== window.windowIndex
      || window.subjectId !== subjectId
      || window.windowIndex !== index + 1
      || window.fixtureOnly !== false
      || window.deploymentDigest !== deploymentBindingDigest(deployment)
      || !validateProgramBinding(window.programDigests, deployment)
      || canonicalJson(window.acquisitionBinding) !== canonicalJson(acquisitionBinding)
      || window.policyId !== policy.policyId
      || window.policyDigest !== policyDigest(policy)
      || !DIGEST.test(String(window.promptCommitmentDigest || ''))
      || window.sealedItemBankDigest !== bank.digest
      || window.assessmentBankRecordDigest !== bank.recordDigest
      || window.assessmentBankId !== bank.bankId
      || canonicalJson(window.assessmentCampaign) !== canonicalJson(bank.campaignBinding)
      || !isRecord(window.qualificationHarvestBinding)
      || !DIGEST.test(String(window.qualificationHarvestBinding.artifactSetSha256 || ''))
      || !IDENTIFIER.test(String(window.sessionId || ''))
      || window.provider !== policy.modelRuntime.provider
      || window.model !== policy.modelRuntime.model
      || window.thinking !== 'xhigh'
      || !Array.isArray(window.toolsUsed) || window.toolsUsed.length !== 0
      || window.threshold !== policy.minimumScore
      || window.status !== 'passed') {
    errors.push(`${label} scope, bank, policy, runtime, or threshold binding is invalid`);
  }
  try {
    assertGraphRubricBytes(graph, rubric, window.programDigests);
  } catch (error) {
    errors.push(`${label} ${error.message}`);
  }
  const notBeforeMs = Date.parse(String(window.notBefore || ''));
  const expiresAtMs = Date.parse(String(window.expiresAt || ''));
  const releasedAtMs = Date.parse(String(window.releasedAt || ''));
  const startedAtMs = Date.parse(String(window.startedAt || ''));
  const completedAtMs = Date.parse(String(window.completedAt || ''));
  const harvestedAtMs = Date.parse(String(window.harvestedAt || ''));
  const evaluatedAtMs = Date.parse(String(evaluatedAt || ''));
  if (![notBeforeMs, expiresAtMs, releasedAtMs, startedAtMs, completedAtMs, harvestedAtMs, evaluatedAtMs]
    .every(Number.isFinite)
      || [window.notBefore, window.expiresAt, window.releasedAt, window.startedAt,
        window.completedAt, window.harvestedAt, evaluatedAt]
        .some((value) => new Date(Date.parse(value)).toISOString() !== value)
      || expiresAtMs < notBeforeMs
      || releasedAtMs < notBeforeMs || releasedAtMs > startedAtMs
      || startedAtMs > completedAtMs || completedAtMs > expiresAtMs
      || harvestedAtMs < completedAtMs || harvestedAtMs > evaluatedAtMs) {
    errors.push(`${label} release, execution, harvest, or evaluation interval is invalid`);
  }
  const rawOutput = canonicalBase64(window.execution?.rawOutputBase64);
  const rawLedger = canonicalBase64(window.execution?.rawEventLedgerBase64);
  const rawStderr = canonicalBase64(window.execution?.rawStderrBase64, {
    allowEmpty: true,
  });
  const workerPromptBytes = canonicalBase64(window.workerPromptBase64);
  let parsedOutput = null;
  if (rawOutput) {
    try { parsedOutput = JSON.parse(rawOutput.toString('utf8')); } catch { parsedOutput = null; }
  }
  if (!exactKeys(window.execution, [
    'attestation',
    'executionIdentity',
    'executionEvidenceCore',
    'executionEvidenceSha256',
    'executionIntervalSha256',
    'jobExpiresAt',
    'jobDigest',
    'jobId',
    'jobNotBefore',
    'outputSha256',
    'promptSha256',
    'rawEventLedgerBase64',
    'rawEventLedgerSha256',
    'rawOutputBase64',
    'rawStderrBase64',
    'rawStderrSha256',
    'startedAt',
    'completedAt',
  ]) || !rawOutput || !rawLedger || rawStderr === null || !workerPromptBytes
      || window.execution.jobId !== `${campaignBinding.campaignId}.retention.${index + 1}`
      || !DIGEST.test(String(window.execution.jobDigest || ''))
      || !DIGEST.test(String(window.execution.executionIntervalSha256 || ''))
      || !isRecord(window.execution.executionIdentity)
      || !canonicalUtcTimestamp(window.execution.jobNotBefore)
      || !canonicalUtcTimestamp(window.execution.jobExpiresAt)
      || window.execution.startedAt !== window.startedAt
      || window.execution.completedAt !== window.completedAt
      || Date.parse(window.execution.startedAt) < Date.parse(window.execution.jobNotBefore)
      || Date.parse(window.execution.completedAt) > Date.parse(window.execution.jobExpiresAt)
      || window.execution.executionIntervalSha256 !== digestRecord({
        jobDigest: window.execution.jobDigest,
        notBefore: window.execution.jobNotBefore,
        startedAt: window.execution.startedAt,
        completedAt: window.execution.completedAt,
        expiresAt: window.execution.jobExpiresAt,
      })
      || window.execution.promptSha256 !== window.workerPromptSha256
      || !exactKeys(parsedOutput, ['answers'])
      || !Array.isArray(parsedOutput.answers)
      || parsedOutput.answers.some((answer) => !exactKeys(answer, ['answer', 'itemId']))) {
    errors.push(`${label} exact execution or raw answer bytes are incomplete or unknown`);
  }
  const executionRecordValidation = validateExecutionEvidenceRecord({
    core: window.execution?.executionEvidenceCore,
    executionEvidenceSha256: window.execution?.executionEvidenceSha256,
  });
  errors.push(...executionRecordValidation.errors.map((error) => (
    `${label} canonical execution evidence: ${error}`
  )));
  if (!isRecord(harvestedWorkerCall)
      || canonicalJson(window.execution?.executionEvidenceCore)
        !== canonicalJson(harvestedWorkerCall.executionEvidenceCore)
      || window.execution?.executionEvidenceSha256
        !== harvestedWorkerCall.executionEvidenceSha256) {
    errors.push(`${label} execution differs from the exact harvested model-call.json`);
  }
  let release = null;
  let expectedWorkerPromptBytes = null;
  try {
    release = retentionReleaseRecord({
      task: window.task,
      bank,
      releasedAt: window.releasedAt,
      fixtureOnly: false,
    });
    expectedWorkerPromptBytes = Buffer.from(buildRetentionWorkerPrompt(release), 'utf8');
    if (canonicalJson(window.release) !== canonicalJson(release)) {
      throw new Error('carried release differs from the exact signed-task/bank materialization');
    }
  } catch (error) {
    errors.push(`${label} signed bank release materialization failed: ${error.message}`);
  }
  const exactJobTask = release ? retentionJobTaskRecord({
    task: window.task,
    release,
    executionDeployment: trustedExecutionDeployment,
  }) : null;
  let trusted = {
    ok: false,
    errors: ['exact raw execution bytes are invalid'],
    payload: null,
    executionEvidenceSha256: null,
  };
  if (rawOutput && rawLedger && rawStderr !== null && expectedWorkerPromptBytes) {
    trusted = verifyTrustedExecutionEvidence({
      attestation: window.execution?.attestation,
      trustPolicy,
      executionEvidenceCore: window.execution?.executionEvidenceCore,
      executionEvidenceSha256: window.execution?.executionEvidenceSha256,
      inputBytes: expectedWorkerPromptBytes,
      rawOutputBytes: rawOutput,
      rawEventLedgerBytes: rawLedger,
      rawStderrBytes: rawStderr,
      expected: {
        provider: policy.modelRuntime.provider,
        model: policy.modelRuntime.model,
        role: 'retention',
        plannedSessionId: window.sessionId,
        promptSha256: window.workerPromptSha256,
        bindings: {
          candidateId: subjectId,
          candidateSessionId: window.sessionId,
          candidateSha256: sha256Bytes(rawOutput),
          taskId: window.taskId,
          taskSha256: exactJobTask ? digestRecord(exactJobTask) : null,
          jobId: `${campaignBinding.campaignId}.retention.${index + 1}`,
          campaignId: campaignBinding.campaignId,
          campaignSha256: campaignBinding.campaignDigest,
          deploymentSha256: deploymentBindingDigest(trustedExecutionDeployment),
          sourceSha256: executionSourceSha256(trustedExecutionDeployment),
        },
        startedAt: window.startedAt,
        completedAt: window.completedAt,
        notBefore: window.notBefore,
        notAfter: window.expiresAt,
        approvedExecutable: trustedExecutionDeployment.approvedModelExecutable,
        command: harvestedWorkerCall?.executionEvidenceCore?.command,
        observedEnvironment: harvestedWorkerCall?.executionEvidenceCore?.environment?.observed,
      },
    });
  }
  if (!trusted.ok
      || !release
      || !expectedWorkerPromptBytes
      || !workerPromptBytes
      || !workerPromptBytes.equals(expectedWorkerPromptBytes)
      || window.workerPromptSha256 !== sha256Bytes(expectedWorkerPromptBytes)
      || window.executionAttestationDigest !== digestRecord(window.execution?.attestation)
      || window.executionEvidenceSha256 !== trusted.executionEvidenceSha256
      || window.execution?.executionEvidenceSha256 !== trusted.executionEvidenceSha256
      || window.execution?.outputSha256 !== (rawOutput && sha256Bytes(rawOutput))
      || window.execution?.rawEventLedgerSha256 !== (rawLedger && sha256Bytes(rawLedger))
      || window.execution?.rawStderrSha256 !== (rawStderr && sha256Bytes(rawStderr))
      || window.usageDigest !== sha256Text(canonicalJson(trusted.payload?.usage))) {
    errors.push(`${label} authenticated canonical execution, exact release, bytes, or bank prompt is invalid: ${trusted.errors.join('; ')}`);
  }
  const answerById = new Map(
    Array.isArray(parsedOutput?.answers)
      ? parsedOutput.answers.map((answer) => [answer.itemId, answer.answer])
      : [],
  );
  let expectedItems = [];
  try {
    const descriptors = bank.items.map((item) => itemDescriptor(item, {
      graph,
      rubric,
      trustPolicy,
      deployment,
      campaignBinding: bank.campaignBinding,
      assessmentBank: bank.assessmentBank,
      fixtureOnly: false,
    }));
    validateItemCoverage(descriptors, policy);
    if (answerById.size !== bank.items.length
        || parsedOutput.answers.length !== bank.items.length) {
      throw new Error('answer set is partial or duplicated');
    }
    expectedItems = bank.items.map((item, itemIndex) => {
      const descriptor = descriptors[itemIndex];
      if (!answerById.has(item.itemId)) throw new Error(`answer set omits ${item.itemId}`);
      const answer = answerById.get(item.itemId);
      const grading = executeIndependentAssessmentItem({
        item,
        answer,
        graph,
        rubric,
        trustPolicy,
        deployment,
        campaignBinding: bank.campaignBinding,
        bank: bank.assessmentBank,
      }).grading;
      return {
        ...descriptor,
        answerDigest: sha256Text(canonicalJson(answer)),
        graderDigest: sha256Text(canonicalJson({
          checker: item.checker,
          grading,
        })),
        passed: grading.passed === true,
      };
    });
  } catch (error) {
    errors.push(`${label} exact signed-bank regrade failed: ${error.message}`);
  }
  const expectedPassedCount = expectedItems.filter((item) => item.passed).length;
  const expectedScore = expectedItems.length > 0
    ? expectedPassedCount / expectedItems.length
    : Number.NaN;
  if (canonicalJson(window.items) !== canonicalJson(expectedItems)
      || window.itemCount !== expectedItems.length
      || window.passedCount !== expectedPassedCount
      || window.score !== expectedScore
      || expectedScore < policy.minimumScore
      || window.truthBoundary
        !== 'This window passed its bounded unseen retention threshold; retained mastery requires the complete two-window signed chain.') {
    errors.push(`${label} signed item results, checker outcomes, score, status, or truth boundary mismatch`);
  }
  return errors;
}

export function evaluateRetentionStatus({
  subjectId,
  windows = [],
  assessmentBanks = [],
  graph = null,
  rubric = null,
  policy,
  deployment,
  executionDeployment = null,
  trustPolicy = null,
  campaignBinding = null,
  acquisitionBinding,
  signingSecret,
  now,
  fixtureOnly = false,
  qualificationHarvestBinding = null,
  harvestedModelCallsByJob = null,
} = {}) {
  assertFixtureOnlyBoolean(fixtureOnly);
  const trustedExecutionDeployment = executionDeployment || deployment;
  const policyValidation = validateRetentionPolicy(policy, { fixtureOnly });
  if (!policyValidation.ok) throw new Error(`invalid retention policy: ${policyValidation.errors.join('; ')}`);
  if (!fixtureOnly
      && policyDigest(policy) !== deployment?.contentDigests?.['retention-policy']) {
    throw new Error('retention policy bytes do not match the deployed retention policy');
  }
  if (!validateAcquisitionBinding(acquisitionBinding)
      || acquisitionBinding.subjectId !== subjectId
      || acquisitionBinding.curriculumId !== policy.curriculumId
      || acquisitionBinding.policyDigest !== deployment?.contentDigests?.['acquisition-policy']) {
    throw new Error('invalid retention acquisition binding');
  }
  if (!fixtureOnly) {
    assertRetentionExecutionDeployment(trustedExecutionDeployment, deployment);
    const trustValidation = validatePhdTrustPolicy(trustPolicy, { requireProduction: true });
    if (!trustValidation.ok
        || sha256Text(canonicalJson(trustPolicy)) !== deployment?.contentDigests?.['trust-policy']) {
      throw new Error(`invalid retention execution trust: ${trustValidation.errors.join('; ')}`);
    }
    if (!Array.isArray(assessmentBanks)
        || assessmentBanks.length !== windows.length
        || !isRecord(graph) || !isRecord(rubric)
        || !exactKeys(campaignBinding, ['campaignDigest', 'campaignId'])
        || !IDENTIFIER.test(String(campaignBinding.campaignId || ''))
        || !DIGEST.test(String(campaignBinding.campaignDigest || ''))) {
      throw new Error('production retention status requires every exact signed bank, graph/rubric bytes, and campaign binding');
    }
    if (windows.length > 0 && (!isRecord(qualificationHarvestBinding)
        || !(harvestedModelCallsByJob instanceof Map))) {
      throw new Error('production retention status requires the exact authenticated qualification harvest');
    }
  }
  controlPlaneTimestamp(now, 'retention status time', {
    fixtureOnly,
    maximumClockSkewSeconds: policy.maximumClockSkewSeconds,
  });
  const errors = [];
  let previous = null;
  for (const [index, window] of windows.entries()) {
    if (window?.schemaVersion !== RETENTION_EVIDENCE_SCHEMA || !verifySignature(window, signingSecret)) {
      errors.push(`window ${index + 1} signature mismatch`);
      continue;
    }
    try {
      assertDeploymentBinding(window.deployment, deployment);
    } catch (error) {
      errors.push(error.message);
    }
    if (window.subjectId !== subjectId || window.windowIndex !== index + 1
        || window.fixtureOnly !== fixtureOnly
        || canonicalJson(window.acquisitionBinding) !== canonicalJson(acquisitionBinding)
        || window.policyDigest !== policyDigest(policy)
        || window.status !== 'passed') errors.push(`window ${index + 1} scope, policy, or threshold failure`);
    if (!fixtureOnly) {
      errors.push(...productionWindowEvidenceErrors({
        window,
        index,
        assessmentBank: assessmentBanks[index],
        subjectId,
        policy,
        deployment,
        executionDeployment: trustedExecutionDeployment,
        trustPolicy,
        campaignBinding,
        acquisitionBinding,
        graph,
        rubric,
        signingSecret,
        evaluatedAt: now,
        harvestedWorkerCall: harvestedModelCallsByJob.get(
          `${campaignBinding.campaignId}.retention.${index + 1}`,
        ) || null,
      }));
      if (canonicalJson(window.qualificationHarvestBinding)
          !== canonicalJson(qualificationHarvestBinding)) {
        errors.push(`window ${index + 1} qualification harvest binding mismatch`);
      }
    }
    if (previous) {
      if (window.previousWindowDigest !== digestRecord(previous)) errors.push(`window ${index + 1} chain mismatch`);
      if (window.sessionId === previous.sessionId) errors.push(`window ${index + 1} session collision`);
      if (Date.parse(window.startedAt) - Date.parse(previous.completedAt)
          < policy.minimumSeparationSeconds * 1000) errors.push(`window ${index + 1} interval compression`);
      const itemIds = new Set(previous.items.map((item) => item.itemId));
      const theoremIds = new Set(previous.items.map((item) => item.theoremId));
      const families = new Set(previous.items.map((item) => item.semanticFamilyId));
      const concepts = new Set(previous.items.map((item) => item.conceptId));
      const outcomes = new Set(previous.items.flatMap((item) => item.outcomeIds));
      if (window.items.some((item) => itemIds.has(item.itemId)
        || theoremIds.has(item.theoremId)
        || families.has(item.semanticFamilyId)
        || concepts.has(item.conceptId)
        || item.outcomeIds.some((outcomeId) => outcomes.has(outcomeId)))) {
        errors.push(`window ${index + 1} item, concept, outcome, or semantic family reuse`);
      }
    }
    previous = window;
  }
  let status;
  let nextEligibleAt = null;
  if (errors.length) status = 'failed';
  else if (windows.length >= policy.requiredWindows) {
    status = fixtureOnly ? 'fixture_retention_complete' : 'retained_mastery_qualified';
  }
  else {
    const base = windows.length
      ? Date.parse(windows.at(-1).completedAt)
      : Date.parse(acquisitionBinding.completedAt);
    nextEligibleAt = new Date(base + (windows.length ? policy.minimumSeparationSeconds * 1000 : 0)).toISOString();
    status = timestamp(now, 'retention status time') < Date.parse(nextEligibleAt)
      ? 'not_eligible_yet'
      : 'eligible_now';
  }
  return sign({
    schemaVersion: RETENTION_STATUS_SCHEMA,
    subjectId,
    evaluatedAt: now,
    fixtureOnly,
    campaignBinding: structuredClone(campaignBinding),
    status,
    completedWindowCount: windows.length,
    requiredWindowCount: policy.requiredWindows,
    windowEvidenceDigests: windows.map((window) => digestRecord(window)),
    executionAttestationDigests: windows.map((window) => (
      window.executionAttestationDigest ?? null
    )),
    executionEvidenceRecords: windows.map((window) => (
      window.execution?.executionEvidenceCore
        ? {
          core: structuredClone(window.execution.executionEvidenceCore),
          executionEvidenceSha256: window.execution.executionEvidenceSha256,
        }
        : null
    )),
    authenticatedWindowIntervals: windows.map((window) => ({
      startedAt: window.startedAt,
      completedAt: window.completedAt,
      notBefore: window.notBefore,
      expiresAt: window.expiresAt,
    })),
    nextEligibleAt,
    errors,
    deploymentDigest: deploymentBindingDigest(trustedExecutionDeployment),
    acquisitionStateDigest: acquisitionBinding.stateDigest,
    retainedMasteryQualified: status === 'retained_mastery_qualified',
    truthBoundary: status === 'retained_mastery_qualified'
      ? 'Only the declared signed two-window retention contract is qualified; this does not establish unrestricted mastery or a degree.'
      : 'Acquisition and elapsed time do not imply retention.',
  }, signingSecret);
}

export function verifyRetentionStatusRecord(status, signingSecret) {
  const expectedKeys = [
    'acquisitionStateDigest',
    'authenticatedWindowIntervals',
    'campaignBinding',
    'completedWindowCount',
    'controlPlaneSignature',
    'deploymentDigest',
    'errors',
    'evaluatedAt',
    'executionAttestationDigests',
    'executionEvidenceRecords',
    'fixtureOnly',
    'nextEligibleAt',
    'requiredWindowCount',
    'retainedMasteryQualified',
    'schemaVersion',
    'status',
    'subjectId',
    'truthBoundary',
    'windowEvidenceDigests',
  ];
  if (!isRecord(status)
      || Object.keys(status).sort().join(',') !== expectedKeys.join(',')
      || status.schemaVersion !== RETENTION_STATUS_SCHEMA
      || !validSignatureEnvelope(status.controlPlaneSignature)
      || !verifySignature(status, signingSecret)
      || !IDENTIFIER.test(String(status.subjectId || ''))
      || ![true, false].includes(status.fixtureOnly)
      || (status.fixtureOnly === false
        ? (!exactKeys(status.campaignBinding, ['campaignDigest', 'campaignId'])
          || !IDENTIFIER.test(String(status.campaignBinding.campaignId || ''))
          || !DIGEST.test(String(status.campaignBinding.campaignDigest || '')))
        : status.campaignBinding !== null)
      || !Number.isFinite(Date.parse(String(status.evaluatedAt || '')))
      || new Date(Date.parse(status.evaluatedAt)).toISOString() !== status.evaluatedAt
      || !DIGEST.test(String(status.deploymentDigest || ''))
      || !DIGEST.test(String(status.acquisitionStateDigest || ''))
      || status.requiredWindowCount !== 2
      || !Number.isInteger(status.completedWindowCount)
      || status.completedWindowCount < 0
      || status.completedWindowCount > status.requiredWindowCount
      || !Array.isArray(status.errors)
      || !status.errors.every((error) => typeof error === 'string' && error.length > 0)
      || !Array.isArray(status.windowEvidenceDigests)
      || status.windowEvidenceDigests.length !== status.completedWindowCount
      || !status.windowEvidenceDigests.every((value) => DIGEST.test(String(value)))
      || new Set(status.windowEvidenceDigests).size !== status.windowEvidenceDigests.length
      || !Array.isArray(status.executionAttestationDigests)
      || status.executionAttestationDigests.length !== status.completedWindowCount
      || !Array.isArray(status.executionEvidenceRecords)
      || status.executionEvidenceRecords.length !== status.completedWindowCount
      || !Array.isArray(status.authenticatedWindowIntervals)
      || status.authenticatedWindowIntervals.length !== status.completedWindowCount) {
    return false;
  }
  if (status.fixtureOnly !== true && (
    !status.executionAttestationDigests.every((value) => DIGEST.test(String(value)))
    || new Set(status.executionAttestationDigests).size !== status.executionAttestationDigests.length
    || !status.executionEvidenceRecords.every((record) => (
      validateExecutionEvidenceRecord(record).ok
    ))
    || new Set(status.executionEvidenceRecords.map((record) => (
      record.executionEvidenceSha256
    ))).size !== status.executionEvidenceRecords.length
  )) return false;
  if (status.fixtureOnly === true
      && !status.executionEvidenceRecords.every((record) => record === null)) return false;

  const intervals = [];
  for (const interval of status.authenticatedWindowIntervals) {
    if (!isRecord(interval)
        || Object.keys(interval).sort().join(',') !== 'completedAt,expiresAt,notBefore,startedAt') {
      return false;
    }
    const parsed = {
      startedAt: Date.parse(String(interval.startedAt || '')),
      completedAt: Date.parse(String(interval.completedAt || '')),
      notBefore: Date.parse(String(interval.notBefore || '')),
      expiresAt: Date.parse(String(interval.expiresAt || '')),
    };
    if (!Object.values(parsed).every(Number.isFinite)
        || new Date(parsed.startedAt).toISOString() !== interval.startedAt
        || new Date(parsed.completedAt).toISOString() !== interval.completedAt
        || new Date(parsed.notBefore).toISOString() !== interval.notBefore
        || new Date(parsed.expiresAt).toISOString() !== interval.expiresAt
        || parsed.notBefore > parsed.startedAt
        || parsed.startedAt > parsed.completedAt
        || parsed.completedAt > parsed.expiresAt) return false;
    intervals.push(parsed);
  }
  if (intervals.length === 2) {
    const separation = intervals[1].startedAt - intervals[0].completedAt;
    if (separation < (status.fixtureOnly ? 1 : PRODUCTION_MINIMUM_SEPARATION_SECONDS * 1000)) {
      return false;
    }
  }
  const evaluatedAt = Date.parse(status.evaluatedAt);
  if (intervals.some((interval) => interval.completedAt > evaluatedAt)) return false;

  const unqualifiedTruth = 'Acquisition and elapsed time do not imply retention.';
  const qualifiedTruth = 'Only the declared signed two-window retention contract is qualified; this does not establish unrestricted mastery or a degree.';
  if (status.status === 'fixture_retention_complete') {
    return status.fixtureOnly === true
      && status.errors.length === 0
      && status.completedWindowCount === status.requiredWindowCount
      && status.retainedMasteryQualified === false
      && status.nextEligibleAt === null
      && status.truthBoundary === unqualifiedTruth;
  }
  if (status.status === 'retained_mastery_qualified') {
    return status.fixtureOnly === false
      && status.errors.length === 0
      && status.completedWindowCount === status.requiredWindowCount
      && status.retainedMasteryQualified === true
      && status.nextEligibleAt === null
      && status.truthBoundary === qualifiedTruth;
  }
  if (status.status === 'failed') {
    return status.errors.length > 0
      && status.retainedMasteryQualified === false
      && status.nextEligibleAt === null
      && status.truthBoundary === unqualifiedTruth;
  }
  if (!['not_eligible_yet', 'eligible_now'].includes(status.status)
      || status.errors.length !== 0
      || status.completedWindowCount >= status.requiredWindowCount
      || status.retainedMasteryQualified !== false
      || status.truthBoundary !== unqualifiedTruth
      || !Number.isFinite(Date.parse(String(status.nextEligibleAt || '')))
      || new Date(Date.parse(status.nextEligibleAt)).toISOString() !== status.nextEligibleAt) return false;
  const nextEligibleAt = Date.parse(status.nextEligibleAt);
  return status.status === 'not_eligible_yet'
    ? evaluatedAt < nextEligibleAt
    : evaluatedAt >= nextEligibleAt;
}

export function verifyProductionRetentionStatusEvidence({
  status,
  windows,
  assessmentBanks,
  policy,
  deployment,
  trustPolicy,
  campaignBinding,
  acquisitionBinding,
  graph,
  rubric,
  signingSecret,
  qualificationHarvestBinding = null,
  harvestedModelCallsByJob = null,
} = {}) {
  const errors = [];
  if (!verifyRetentionStatusRecord(status, signingSecret)
      || status?.fixtureOnly !== false
      || canonicalJson(status?.campaignBinding) !== canonicalJson(campaignBinding)) {
    errors.push('production retention status fields, signature, or campaign binding are invalid');
  }
  if (!Array.isArray(windows)
      || windows.length !== status?.completedWindowCount
      || !Array.isArray(assessmentBanks)
      || assessmentBanks.length !== windows?.length) {
    errors.push('production retention status omits or substitutes its window evidence or signed banks');
  }
  if (errors.length > 0) return { ok: false, errors };
  let recomputed;
  try {
    recomputed = evaluateRetentionStatus({
      subjectId: status.subjectId,
      windows,
      assessmentBanks,
      graph,
      rubric,
      policy,
      deployment,
      trustPolicy,
      campaignBinding,
      acquisitionBinding,
      signingSecret,
      now: status.evaluatedAt,
      fixtureOnly: false,
      qualificationHarvestBinding,
      harvestedModelCallsByJob,
    });
  } catch (error) {
    errors.push(error.message);
    return { ok: false, errors };
  }
  if (canonicalJson(recomputed) !== canonicalJson(status)) {
    errors.push('signed retention status is not the exact recomputation of its windows, executions, and banks');
  }
  return { ok: errors.length === 0, errors };
}

export function verifyProductionRetentionQualification({
  status,
  windows,
  assessmentBanks,
  policy,
  deployment,
  trustPolicy,
  campaignBinding,
  acquisitionBinding,
  graph,
  rubric,
  signingSecret,
  qualificationHarvestBinding = null,
  harvestedModelCallsByJob = null,
} = {}) {
  const errors = [];
  if (!verifyRetentionStatusRecord(status, signingSecret)
      || status?.fixtureOnly !== false
      || status?.status !== 'retained_mastery_qualified'
      || status?.retainedMasteryQualified !== true
      || status?.requiredWindowCount !== 2
      || status?.completedWindowCount !== 2
      || canonicalJson(status?.campaignBinding) !== canonicalJson(campaignBinding)
      || !Array.isArray(status?.errors) || status.errors.length !== 0) {
    errors.push('production retained status fields, signature, counts, errors, or retained flag are invalid');
  }
  if (!Array.isArray(windows) || windows.length !== 2
      || !Array.isArray(assessmentBanks) || assessmentBanks.length !== 2) {
    errors.push('production retention qualification requires exactly two evidence records and two signed banks');
  }
  if (Array.isArray(windows) && windows.length === 2
      && Array.isArray(assessmentBanks) && assessmentBanks.length === 2) {
    for (const [index, window] of windows.entries()) {
      const bank = assessmentBanks[index];
      const executionEvidenceRecord = {
        core: window?.execution?.executionEvidenceCore,
        executionEvidenceSha256: window?.execution?.executionEvidenceSha256,
      };
      if (!isRecord(window) || !isRecord(bank)
          || !isRecord(qualificationHarvestBinding)
          || canonicalJson(window?.qualificationHarvestBinding)
            !== canonicalJson(qualificationHarvestBinding)
          || !(harvestedModelCallsByJob instanceof Map)
          || canonicalJson(window?.execution?.executionEvidenceCore)
            !== canonicalJson(harvestedModelCallsByJob.get(
              `${campaignBinding?.campaignId}.retention.${index + 1}`,
            )?.executionEvidenceCore)
          || window?.execution?.executionEvidenceSha256
            !== harvestedModelCallsByJob.get(
              `${campaignBinding?.campaignId}.retention.${index + 1}`,
            )?.executionEvidenceSha256
          || !isRecord(window.execution?.attestation)
          || !validateExecutionEvidenceRecord(executionEvidenceRecord).ok
          || status?.windowEvidenceDigests?.[index] !== digestRecord(window)
          || status?.executionAttestationDigests?.[index] !== window.executionAttestationDigest
          || canonicalJson(status?.executionEvidenceRecords?.[index])
            !== canonicalJson(executionEvidenceRecord)
          || window.executionAttestationDigest !== digestRecord(window.execution?.attestation)
          || window.executionEvidenceSha256 !== executionEvidenceRecord.executionEvidenceSha256
          || window.assessmentBankRecordDigest !== digestRecord(bank)
          || window.sealedItemBankDigest !== bank.bankDigest
          || window.assessmentBankId !== bank.bankId
          || canonicalJson(window.assessmentCampaign) !== canonicalJson(bank.bindings?.campaign)) {
        errors.push(`production retention window ${index + 1} substitutes evidence, execution attestation, or signed bank bytes`);
      }
    }
    if (digestRecord(assessmentBanks[0]) === digestRecord(assessmentBanks[1])) {
      errors.push('production retention qualification substituted or reused a signed bank');
    }
    const first = windows[0];
    const second = windows[1];
    const itemIds = new Set((first.items || []).map((item) => item.itemId));
    const theoremIds = new Set((first.items || []).map((item) => item.theoremId));
    const families = new Set((first.items || []).map((item) => item.semanticFamilyId));
    const concepts = new Set((first.items || []).map((item) => item.conceptId));
    const outcomes = new Set((first.items || []).flatMap((item) => item.outcomeIds || []));
    if ((second.items || []).some((item) => itemIds.has(item.itemId)
        || theoremIds.has(item.theoremId)
        || families.has(item.semanticFamilyId)
        || concepts.has(item.conceptId)
        || (item.outcomeIds || []).some((outcomeId) => outcomes.has(outcomeId)))) {
      errors.push('production retention windows overlap or reuse item, concept, outcome, or semantic family');
    }
    const minimumSeparationSeconds = Math.max(
      PRODUCTION_MINIMUM_SEPARATION_SECONDS,
      Number(policy?.minimumSeparationSeconds) || 0,
    );
    if (Date.parse(String(second.startedAt || '')) - Date.parse(String(first.completedAt || ''))
        < minimumSeparationSeconds * 1000) {
      errors.push('production retention authenticated interval separation is below 604800 seconds');
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const evidenceValidation = verifyProductionRetentionStatusEvidence({
    status,
    windows,
    assessmentBanks,
    policy,
    deployment,
    trustPolicy,
    campaignBinding,
    acquisitionBinding,
    graph,
    rubric,
    signingSecret,
    qualificationHarvestBinding,
    harvestedModelCallsByJob,
  });
  errors.push(...evidenceValidation.errors);
  return { ok: errors.length === 0, errors };
}

function exactResumeCommandFlag(command, flag) {
  if (!Array.isArray(command)) return null;
  const positions = command.flatMap((entry, index) => (
    entry === flag ? [index] : []
  ));
  if (positions.length !== 1 || positions[0] + 1 >= command.length) return null;
  return command[positions[0] + 1];
}

function resumeCommandOmits(command, flags) {
  return flags.every((flag) => !command.includes(flag));
}

export function verifyRetentionWaitContract(contract, signingSecret) {
  if (!isRecord(contract)
      || contract.schemaVersion !== RETENTION_WAIT_SCHEMA
      || !validSignatureEnvelope(contract.controlPlaneSignature)
      || !verifySignature(contract, signingSecret)
      || !IDENTIFIER.test(String(contract.subjectId || ''))
      || typeof contract.fixtureOnly !== 'boolean'
      || contract.status !== 'not_eligible_yet'
      || !DIGEST.test(String(contract.sourceStatusDigest || ''))
      || !validSignatureEnvelope(contract.sourceStatusSignature)
      || !DIGEST.test(String(contract.deploymentDigest || ''))
      || !DIGEST.test(String(contract.acquisitionStateDigest || ''))
      || (contract.fixtureOnly === true
        ? contract.campaignBinding !== null
          || contract.dueTaskDigest !== null
        : (!exactKeys(contract.campaignBinding, ['campaignDigest', 'campaignId'])
          || !IDENTIFIER.test(String(contract.campaignBinding.campaignId || ''))
          || !DIGEST.test(String(contract.campaignBinding.campaignDigest || ''))
          || !DIGEST.test(String(contract.dueTaskDigest || ''))))
      || !Number.isInteger(contract.nextWindowIndex)
      || contract.nextWindowIndex < 1
      || contract.nextWindowIndex > 2
      || (contract.nextWindowIndex === 1
        ? contract.previousWindowDigest !== null
        : !DIGEST.test(String(contract.previousWindowDigest || '')))
      || contract.sourceStatusSignature.keyId
        !== contract.controlPlaneSignature.keyId
      || !canonicalUtcTimestamp(contract.createdAt)
      || !canonicalUtcTimestamp(contract.resumeAt)
      || Date.parse(contract.createdAt) >= Date.parse(contract.resumeAt)
      || !SAFE_ABSOLUTE_PATH.test(String(contract.statePath || ''))
      || !SAFE_ABSOLUTE_PATH.test(String(contract.resumeBundlePath || ''))
      || !SAFE_ABSOLUTE_PATH.test(String(contract.releasePath || ''))
      || !SAFE_ABSOLUTE_PATH.test(String(contract.timerJournalPath || ''))
      || contract.timerJournalPath !== `${contract.statePath}.timer-journal.json`
      || !SAFE_ABSOLUTE_PATH.test(`${String(contract.timerJournalPath || '')}.lock`)
      || !SAFE_ABSOLUTE_PATH.test(String(contract.stateRootIdentity?.path || ''))
      || !exactObjectKeys(contract.stateRootIdentity, [
        'ancestorChainSha256', 'device', 'gid', 'inode', 'mode', 'path',
        'production', 'serviceGid', 'serviceGroup', 'serviceUid', 'serviceUser',
        'identitySources', 'uid',
      ])
      || !Number.isSafeInteger(contract.stateRootIdentity.uid)
      || !Number.isSafeInteger(contract.stateRootIdentity.gid)
      || !Number.isSafeInteger(contract.stateRootIdentity.device)
      || !Number.isSafeInteger(contract.stateRootIdentity.inode)
      || !Number.isSafeInteger(contract.stateRootIdentity.serviceUid)
      || !Number.isSafeInteger(contract.stateRootIdentity.serviceGid)
      || !/^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(
        String(contract.stateRootIdentity.serviceUser || ''),
      )
      || !/^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(
        String(contract.stateRootIdentity.serviceGroup || ''),
      )
      || !DIGEST.test(String(contract.stateRootIdentity.ancestorChainSha256 || ''))
      || contract.stateRootIdentity.production !== (contract.fixtureOnly !== true)
      || (contract.fixtureOnly === true
        ? contract.stateRootIdentity.identitySources !== null
        : !validRetentionIdentitySourceBinding(
          contract.stateRootIdentity.identitySources,
        ))
      || contract.stateRootIdentity.mode !== '0700'
      || (contract.fixtureOnly !== true && (
        contract.stateRootIdentity.uid !== contract.stateRootIdentity.serviceUid
        || contract.stateRootIdentity.gid !== contract.stateRootIdentity.serviceGid
        || contract.stateRootIdentity.serviceUid === 0
        || contract.stateRootIdentity.serviceUser !== 'cortex-retention'
      ))
      || !exactObjectKeys(contract.resumeExecution, [
        'checkoutRoot', 'closureSha256', 'entrypointPath', 'entrypointSha256',
        'executablePath', 'executableSha256', 'executionClosure', 'helperPaths',
        'runtimeClosure', 'runtimeReadOnlyBinds', 'runtimeReadWriteBinds',
        'serviceUser',
      ])
      || !SAFE_ABSOLUTE_PATH.test(String(contract.resumeExecution.checkoutRoot || ''))
      || !SAFE_ABSOLUTE_PATH.test(String(contract.resumeExecution.executablePath || ''))
      || !SAFE_ABSOLUTE_PATH.test(String(contract.resumeExecution.entrypointPath || ''))
      || !DIGEST.test(String(contract.resumeExecution.executableSha256 || ''))
      || !DIGEST.test(String(contract.resumeExecution.entrypointSha256 || ''))
      || !DIGEST.test(String(contract.resumeExecution.closureSha256 || ''))
      || (contract.fixtureOnly === true
        ? (contract.resumeExecution.executionClosure !== null
          || contract.resumeExecution.runtimeClosure !== null
          || contract.resumeExecution.runtimeReadOnlyBinds !== null
          || contract.resumeExecution.runtimeReadWriteBinds !== null
          || contract.resumeExecution.helperPaths !== null)
        : (!isRecord(contract.resumeExecution.executionClosure)
          || contract.resumeExecution.executionClosure.immutable !== true
          || contract.resumeExecution.executionClosure.closureSha256
            !== contract.resumeExecution.closureSha256
          || !validateProcessRuntimeClosure(contract.resumeExecution.runtimeClosure).ok
          || contract.resumeExecution.runtimeClosure.executablePath
            !== contract.resumeExecution.executablePath
          || !contract.resumeExecution.runtimeClosure.rootDirectory.startsWith(
            `${PROCESS_RUNTIME_STORE_ROOT}/`,
          )
          || canonicalJson(contract.resumeExecution.runtimeReadOnlyBinds)
            !== canonicalJson([
              contract.resumeExecution.checkoutRoot,
              RETENTION_DURABLE_UNIT_DIRECTORY,
              ...Object.values(RETENTION_IDENTITY_SOURCE_PATHS),
              ...Object.values(RETENTION_RUNTIME_EXTERNAL_PATHS),
            ].sort())
          || canonicalJson(contract.resumeExecution.runtimeReadWriteBinds)
            !== canonicalJson([contract.stateRootIdentity.path])
          || !exactObjectKeys(contract.resumeExecution.helperPaths, [
            'busctl', 'flock', 'getfacl', 'git', 'systemctl',
          ])
          || Object.values(contract.resumeExecution.helperPaths).some((helperPath) => (
            !SAFE_ABSOLUTE_PATH.test(String(helperPath || ''))
            || !contract.resumeExecution.runtimeClosure.entries.some((entry) => (
              entry.type === 'file'
              && entry.role === 'helper_executable'
              && entry.path === helperPath
            ))
          ))
          || [
            ...contract.resumeExecution.runtimeReadOnlyBinds,
            ...contract.resumeExecution.runtimeReadWriteBinds,
          ].some((mountPath) => (
            !contract.resumeExecution.runtimeClosure.entries.some((entry) => (
              entry.role === 'mount_target'
              && entry.path === mountPath
            ))
          ))))
      || !/^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(String(contract.resumeExecution.serviceUser || ''))
      || contract.resumeExecution.serviceUser !== contract.stateRootIdentity.serviceUser
      || !exactObjectKeys(contract.privilegedTimerBroker, [
        'authorization', 'deploymentDigest', 'permittedMutations',
        'requiredEuid', 'schemaVersion', 'systemctlPath', 'unitDirectory',
      ])
      || contract.privilegedTimerBroker.schemaVersion
        !== 'cortex.learning_os.retention_timer_broker_policy.v1'
      || contract.privilegedTimerBroker.authorization
        !== 'local-root-only-no-polkit-delegation'
      || contract.privilegedTimerBroker.requiredEuid !== 0
      || contract.privilegedTimerBroker.deploymentDigest !== contract.deploymentDigest
      || canonicalJson(contract.privilegedTimerBroker.permittedMutations)
        !== canonicalJson([
          'publish_exact_authenticated_unit_bytes',
          'systemctl_daemon_reload',
          'systemctl_enable_exact_timer',
        ])
      || contract.privilegedTimerBroker.unitDirectory
        !== (contract.fixtureOnly
          ? path.join(contract.stateRootIdentity.path, '.retention-systemd-units')
          : RETENTION_DURABLE_UNIT_DIRECTORY)
      || (contract.fixtureOnly
        ? contract.privilegedTimerBroker.systemctlPath !== null
        : contract.privilegedTimerBroker.systemctlPath
          !== contract.resumeExecution.helperPaths.systemctl)
      || contract.statePath === contract.releasePath
      || contract.statePath === contract.timerJournalPath
      || contract.releasePath === contract.timerJournalPath
      || new Set([
        contract.statePath,
        contract.resumeBundlePath,
        contract.releasePath,
        contract.timerJournalPath,
        `${contract.timerJournalPath}.lock`,
        contract.notifier?.path,
      ]).size !== 6
      || !isRecord(contract.notifier)
      || contract.notifier.compatible !== true
      || !SAFE_ABSOLUTE_PATH.test(String(contract.notifier.path || ''))
      || canonicalJson(contract.notifier.terminalStatuses)
        !== canonicalJson(contract.fixtureOnly
          ? ['failed', 'fixture_retention_complete']
          : ['failed', 'retained_mastery_qualified'])
      || !Array.isArray(contract.resumeCommand)
      || contract.resumeCommand.length < 2
      || contract.resumeCommand.some((entry) => !SAFE_COMMAND_ARGUMENT.test(String(entry || '')))
      || exactResumeCommandFlag(contract.resumeCommand, '--bundle')
        !== contract.resumeBundlePath
      || exactResumeCommandFlag(contract.resumeCommand, '--wait-state')
        !== contract.statePath
      || (contract.fixtureOnly === true
        ? !resumeCommandOmits(contract.resumeCommand, [
          '--expected-subject-id',
          '--expected-campaign-id',
          '--expected-campaign-digest',
          '--expected-deployment-digest',
          '--expected-key-id',
          '--expected-window-index',
          '--expected-previous-window-digest',
          '--expected-task-digest',
        ])
        : (exactResumeCommandFlag(contract.resumeCommand, '--expected-subject-id')
            !== contract.subjectId
          || exactResumeCommandFlag(contract.resumeCommand, '--expected-campaign-id')
            !== contract.campaignBinding.campaignId
          || exactResumeCommandFlag(contract.resumeCommand, '--expected-campaign-digest')
            !== contract.campaignBinding.campaignDigest
          || exactResumeCommandFlag(contract.resumeCommand, '--expected-deployment-digest')
            !== contract.deploymentDigest
          || exactResumeCommandFlag(contract.resumeCommand, '--expected-key-id')
            !== contract.controlPlaneSignature.keyId
          || exactResumeCommandFlag(contract.resumeCommand, '--expected-window-index')
            !== String(contract.nextWindowIndex)
          || exactResumeCommandFlag(
            contract.resumeCommand,
            '--expected-previous-window-digest',
          ) !== (contract.previousWindowDigest ?? 'none')
          || exactResumeCommandFlag(contract.resumeCommand, '--expected-task-digest')
            !== contract.dueTaskDigest))
      || contract.chatTurnHeld !== false
      || contract.routineReviewScheduled !== false
      || ![false, true].includes(contract.persisted)
      || ![false, true].includes(contract.timerInstalled)
      || ![false, true].includes(contract.timerReleased)
      || (contract.timerReleased === true && contract.timerInstalled !== true)
      || typeof contract.truthBoundary !== 'string'
      || contract.truthBoundary.length < 20) {
    return false;
  }
  const expectedKeys = [
    'schemaVersion', 'subjectId', 'fixtureOnly', 'status', 'sourceStatusDigest',
    'sourceStatusSignature', 'campaignBinding', 'deploymentDigest',
    'acquisitionStateDigest', 'nextWindowIndex', 'previousWindowDigest',
    'dueTaskDigest',
    'createdAt', 'resumeAt', 'statePath',
    'resumeBundlePath', 'releasePath', 'timerJournalPath', 'notifier',
    'stateRootIdentity', 'resumeCommand', 'resumeExecution', 'privilegedTimerBroker',
    'chatTurnHeld', 'routineReviewScheduled', 'persisted',
    'timerInstalled', 'timerReleased', 'truthBoundary',
    'controlPlaneSignature',
  ];
  if (contract.persisted === true) expectedKeys.push('waitPath', 'persistedAt');
  if (contract.timerInstalled === true) {
    expectedKeys.push(
      'sourceWaitDigest',
      'timerInstallationReceipt',
      'timerInstalledAt',
      'timerServiceUnit',
      'timerSpecDigest',
      'timerUnit',
    );
  }
  const hasInstallationRevision = Object.hasOwn(
    contract,
    'timerInstallationRevision',
  );
  const hasSupersededInstalledWaitDigest = Object.hasOwn(
    contract,
    'supersededInstalledWaitDigest',
  );
  if (hasInstallationRevision && hasSupersededInstalledWaitDigest) {
    expectedKeys.push(
      'timerInstallationRevision',
      'supersededInstalledWaitDigest',
    );
  } else if (hasInstallationRevision || hasSupersededInstalledWaitDigest) {
    return false;
  }
  if (contract.timerReleased === true) {
    expectedKeys.push(
      'sourceInstalledWaitDigest',
      'timerFiredAt',
      'releaseDigest',
      'releaseFileSha256',
      'timerReleaseReceipt',
      'timerReleasedAt',
    );
  }
  if (!exactObjectKeys(contract, expectedKeys)) return false;
  const has = (field) => Object.hasOwn(contract, field);
  if (contract.persisted === false) {
    return contract.timerInstalled === false
      && contract.timerReleased === false
      && ![
        'waitPath', 'persistedAt', 'sourceWaitDigest', 'timerInstalledAt',
        'timerInstallationReceipt', 'timerServiceUnit', 'timerSpecDigest', 'timerUnit',
        'timerInstallationRevision', 'supersededInstalledWaitDigest',
        'sourceInstalledWaitDigest', 'timerFiredAt', 'releaseDigest',
        'releaseFileSha256', 'timerReleaseReceipt', 'timerReleasedAt',
      ].some(has);
  }
  if (contract.waitPath !== contract.statePath
      || !canonicalUtcTimestamp(contract.persistedAt)
      || Date.parse(contract.persistedAt) < Date.parse(contract.createdAt)
      || Date.parse(contract.persistedAt) >= Date.parse(contract.resumeAt)) {
    return false;
  }
  if (contract.timerInstalled === false) {
    return contract.timerReleased === false
      && ![
        'sourceWaitDigest', 'timerInstalledAt', 'timerServiceUnit',
        'timerInstallationReceipt', 'timerSpecDigest', 'timerUnit', 'sourceInstalledWaitDigest',
        'timerInstallationRevision', 'supersededInstalledWaitDigest',
        'timerFiredAt', 'releaseDigest', 'releaseFileSha256',
        'timerReleaseReceipt', 'timerReleasedAt',
      ].some(has);
  }
  if (!DIGEST.test(String(contract.sourceWaitDigest || ''))
      || !DIGEST.test(String(contract.timerSpecDigest || ''))
      || (hasInstallationRevision && (
        !Number.isSafeInteger(contract.timerInstallationRevision)
        || contract.timerInstallationRevision < 1
        || !DIGEST.test(String(contract.supersededInstalledWaitDigest || ''))
      ))
      || !canonicalUtcTimestamp(contract.timerInstalledAt)
      || Date.parse(contract.timerInstalledAt) < Date.parse(contract.persistedAt)
      || !/^[A-Za-z0-9_.@-]+[.]service$/.test(String(contract.timerServiceUnit || ''))
      || !/^[A-Za-z0-9_.@-]+[.]timer$/.test(String(contract.timerUnit || ''))) {
    return false;
  }
  const sourceWait = sign(waitBase(contract), signingSecret);
  const timerSpec = buildRetentionTimerSpec(sourceWait);
  if (contract.sourceWaitDigest !== digestRecord(sourceWait)
      || contract.timerSpecDigest !== timerSpec.specDigest
      || contract.timerServiceUnit !== timerSpec.serviceUnit
      || contract.timerUnit !== timerSpec.timerUnit
      || !timerInstallationReceiptValid(
        contract.timerInstallationReceipt,
        timerSpec,
        contract.timerInstalledAt,
      )) {
    return false;
  }
  if (contract.timerReleased === false) {
    return ![
      'sourceInstalledWaitDigest', 'timerFiredAt', 'releaseDigest',
      'releaseFileSha256', 'timerReleaseReceipt', 'timerReleasedAt',
    ].some(has);
  }
  const installedWait = sign(installedWaitBase(contract), signingSecret);
  return contract.sourceInstalledWaitDigest === digestRecord(installedWait)
    && DIGEST.test(String(contract.releaseDigest || ''))
    && DIGEST.test(String(contract.releaseFileSha256 || ''))
    && canonicalUtcTimestamp(contract.timerFiredAt)
    && canonicalUtcTimestamp(contract.timerReleasedAt)
    && Date.parse(contract.timerFiredAt) >= Date.parse(contract.resumeAt)
    && Date.parse(contract.timerReleasedAt) >= Date.parse(contract.timerFiredAt)
    && timerReleaseReceiptValid(contract.timerReleaseReceipt, timerSpec, {
      confirmedAt: contract.timerReleasedAt,
      releaseDigest: contract.releaseDigest,
      releaseFileSha256: contract.releaseFileSha256,
    })
    && contract.timerReleaseReceipt.firedAt === contract.timerFiredAt;
}

function parsePasswdLine(line) {
  const fields = String(line || '').split(':');
  const uid = Number(fields[2]);
  const gid = Number(fields[3]);
  if (fields.length !== 7
      || !/^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(String(fields[0] || ''))
      || !/^(?:0|[1-9][0-9]{0,9})$/.test(String(fields[2] || ''))
      || !/^(?:0|[1-9][0-9]{0,9})$/.test(String(fields[3] || ''))
      || !Number.isSafeInteger(uid) || uid < 0 || uid >= 0xffff_ffff
      || !Number.isSafeInteger(gid) || gid < 0 || gid >= 0xffff_ffff
      || fields.some((field) => /[\0\r\n]/.test(field))) {
    throw new Error('production retention service passwd identity is unsafe');
  }
  return { user: fields[0], uid, gid };
}

function parseGroupLine(line) {
  const fields = String(line || '').split(':');
  const gid = Number(fields[2]);
  const members = fields[3] === ''
    ? []
    : fields[3].split(',');
  if (fields.length !== 4
      || !/^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(String(fields[0] || ''))
      || !/^(?:0|[1-9][0-9]{0,9})$/.test(String(fields[2] || ''))
      || !Number.isSafeInteger(gid) || gid < 0 || gid >= 0xffff_ffff
      || fields.some((field) => /[\0\r\n]/.test(field))
      || members.some((member) => (
        !/^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(member)
      ))
      || new Set(members).size !== members.length) {
    throw new Error('production retention service group identity is unsafe');
  }
  return { group: fields[0], gid, members };
}

function readRootOwnedRetentionIdentitySource(sourcePath) {
  if (process.platform !== 'linux' || !fs.existsSync('/proc/self/fd')) {
    throw new Error('production retention identity sources require Linux descriptor traversal');
  }
  const resolved = path.resolve(sourcePath);
  if (!Object.values(RETENTION_IDENTITY_SOURCE_PATHS).includes(resolved)) {
    throw new Error('production retention identity source path is not allowlisted');
  }
  const descriptors = [];
  const directoryFlags = fs.constants.O_RDONLY
    | (fs.constants.O_DIRECTORY || 0)
    | (fs.constants.O_NOFOLLOW || 0)
    | (fs.constants.O_CLOEXEC || 0);
  const fileFlags = fs.constants.O_RDONLY
    | (fs.constants.O_NOFOLLOW || 0)
    | (fs.constants.O_NONBLOCK || 0)
    | (fs.constants.O_CLOEXEC || 0);
  try {
    const filesystemRoot = path.parse(resolved).root;
    let current = fs.openSync(filesystemRoot, directoryFlags);
    descriptors.push(current);
    let traversed = filesystemRoot;
    const components = resolved.slice(filesystemRoot.length).split(path.sep).filter(Boolean);
    const basename = components.pop();
    for (const component of components) {
      const stat = fs.fstatSync(current);
      if (!stat.isDirectory()
          || stat.uid !== 0
          || stat.gid !== 0
          || (stat.mode & 0o022) !== 0) {
        throw new Error(
          `production retention identity source ancestor is unsafe: ${traversed}`,
        );
      }
      const next = fs.openSync(
        `/proc/self/fd/${current}/${component}`,
        directoryFlags,
      );
      descriptors.push(next);
      current = next;
      traversed = path.join(traversed, component);
    }
    const parentStat = fs.fstatSync(current);
    if (!parentStat.isDirectory()
        || parentStat.uid !== 0
        || parentStat.gid !== 0
        || (parentStat.mode & 0o022) !== 0) {
      throw new Error(
        `production retention identity source ancestor is unsafe: ${traversed}`,
      );
    }
    const descriptor = fs.openSync(
      `/proc/self/fd/${current}/${basename}`,
      fileFlags,
    );
    descriptors.push(descriptor);
    const before = fs.fstatSync(descriptor);
    if (!before.isFile()
        || before.uid !== 0
        || before.gid !== 0
        || before.nlink !== 1
        || (before.mode & 0o022) !== 0
        || before.size < 1
        || before.size > RETENTION_IDENTITY_SOURCE_MAX_BYTES) {
      throw new Error(
        `production retention identity source ownership, mode, link count, or size is unsafe: ${resolved}`,
      );
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (bytes.length !== before.size
        || after.dev !== before.dev
        || after.ino !== before.ino
        || after.uid !== before.uid
        || after.gid !== before.gid
        || after.mode !== before.mode
        || after.nlink !== before.nlink
        || after.size !== before.size
        || after.mtimeMs !== before.mtimeMs
        || after.ctimeMs !== before.ctimeMs) {
      throw new Error(
        `production retention identity source changed while reading: ${resolved}`,
      );
    }
    return {
      path: resolved,
      bytes,
      device: before.dev,
      inode: before.ino,
      uid: before.uid,
      gid: before.gid,
      mode: before.mode & 0o7777,
      nlink: before.nlink,
      size: before.size,
      type: 'regular',
    };
  } finally {
    while (descriptors.length > 0) fs.closeSync(descriptors.pop());
  }
}

function validatedIdentitySourceBytes(sourceReader, sourcePath) {
  const source = sourceReader(sourcePath);
  if (!isRecord(source)
      || !exactObjectKeys(source, [
        'bytes', 'device', 'gid', 'inode', 'mode', 'nlink', 'path', 'size',
        'type', 'uid',
      ])
      || source.path !== sourcePath
      || !Buffer.isBuffer(source.bytes)
      || !Number.isSafeInteger(source.device)
      || source.device < 0
      || !Number.isSafeInteger(source.inode)
      || source.inode < 1
      || source.uid !== 0
      || source.gid !== 0
      || !Number.isSafeInteger(source.mode)
      || (source.mode & 0o022) !== 0
      || (source.mode & 0o400) === 0
      || source.nlink !== 1
      || source.size !== source.bytes.length
      || source.size < 1
      || source.size > RETENTION_IDENTITY_SOURCE_MAX_BYTES
      || source.type !== 'regular') {
    throw new Error(
      `production retention identity source is not a root-owned, non-writable regular file: ${sourcePath}`,
    );
  }
  const text = source.bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(source.bytes)
      || /[\0\r]/.test(text)) {
    throw new Error(`production retention identity source encoding is unsafe: ${sourcePath}`);
  }
  return source.bytes;
}

function normalizedFilesOnlyRetentionNssPolicy(nsswitchBytes) {
  const records = new Map();
  for (const original of nsswitchBytes.toString('utf8').split('\n')) {
    const line = original.replace(/#.*$/u, '').trim();
    if (line === '') continue;
    if (line.includes('\\')) {
      throw new Error('production retention NSS policy contains an unsupported continuation');
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]{0,63}):[ \t]*(.*?)$/.exec(line);
    if (!match) {
      throw new Error('production retention NSS policy syntax is unsafe');
    }
    const [, database, sources] = match;
    if (records.has(database)) {
      throw new Error(`production retention NSS policy duplicates ${database}`);
    }
    records.set(database, sources.trim());
  }
  for (const database of ['passwd', 'group']) {
    if (records.get(database) !== 'files') {
      throw new Error(
        `production retention NSS ${database} source must be exactly the local files provider`,
      );
    }
  }
  if (records.has('initgroups') && records.get('initgroups') !== 'files') {
    throw new Error(
      'production retention NSS initgroups source must be exactly the local files provider',
    );
  }
  return {
    schemaVersion: RETENTION_IDENTITY_SOURCE_SCHEMA,
    policy: 'files-only',
    passwdProvider: 'files',
    groupProvider: 'files',
    // With a files-only group database, an omitted initgroups entry and an
    // explicit "initgroups: files" entry have the same security semantics.
    // Normalize both forms so comments, unrelated databases, and equivalent
    // spelling changes do not strand an authenticated delayed operation.
    initgroupsProvider: 'files',
  };
}

function parseIdentitySourceRecords(bytes, database, parser) {
  const text = bytes.toString('utf8');
  const lines = text.split('\n').filter((line) => line !== '');
  if (lines.length === 0) {
    throw new Error(`production retention ${database} source is empty`);
  }
  return lines.map((line) => parser(line));
}

function snapshotRetentionIdentitySources(
  sourceReader = readRootOwnedRetentionIdentitySource,
) {
  const nsswitchBytes = validatedIdentitySourceBytes(
    sourceReader,
    RETENTION_IDENTITY_SOURCE_PATHS.nsswitch,
  );
  const passwdBytes = validatedIdentitySourceBytes(
    sourceReader,
    RETENTION_IDENTITY_SOURCE_PATHS.passwd,
  );
  const groupBytes = validatedIdentitySourceBytes(
    sourceReader,
    RETENTION_IDENTITY_SOURCE_PATHS.group,
  );
  const binding = normalizedFilesOnlyRetentionNssPolicy(nsswitchBytes);
  return {
    binding,
    passwdRecords: parseIdentitySourceRecords(
      passwdBytes,
      'passwd',
      parsePasswdLine,
    ),
    groupRecords: parseIdentitySourceRecords(
      groupBytes,
      'group',
      parseGroupLine,
    ),
  };
}

function validRetentionIdentitySourceBinding(binding) {
  return exactObjectKeys(binding, [
    'groupProvider', 'initgroupsProvider', 'passwdProvider', 'policy',
    'schemaVersion',
  ])
    && binding.schemaVersion === RETENTION_IDENTITY_SOURCE_SCHEMA
    && binding.policy === 'files-only'
    && binding.passwdProvider === 'files'
    && binding.groupProvider === 'files'
    && binding.initgroupsProvider === 'files';
}

function resolveDedicatedRetentionServiceIdentity(
  serviceUser,
  sourceReader = readRootOwnedRetentionIdentitySource,
) {
  // Bare getent enumeration has no portable completeness guarantee. Production
  // therefore accepts only a files-only NSS policy and proves uniqueness by
  // directly parsing the descriptor-validated, root-owned source databases.
  const snapshot = snapshotRetentionIdentitySources(sourceReader);
  const { passwdRecords, groupRecords } = snapshot;
  const namedPasswdRecords = passwdRecords.filter((record) => (
    record.user === serviceUser
  ));
  if (namedPasswdRecords.length !== 1) {
    throw new Error(
      'production retention service identity is remapped, shared, or has supplementary groups',
    );
  }
  const passwd = namedPasswdRecords[0];
  const uidOwners = passwdRecords.filter((record) => record.uid === passwd.uid);
  const primaryGroupUsers = passwdRecords.filter((record) => (
    record.gid === passwd.gid
  ));
  const gidGroups = groupRecords.filter((record) => record.gid === passwd.gid);
  if (gidGroups.length !== 1) {
    throw new Error(
      'production retention service identity is remapped, shared, or has supplementary groups',
    );
  }
  const group = gidGroups[0];
  const namedGroupRecords = groupRecords.filter((record) => (
    record.group === group.group
  ));
  const explicitMemberships = groupRecords.filter((record) => (
    record.members.includes(serviceUser)
  ));
  const exactUidOwner = uidOwners.length === 1
    && uidOwners[0].user === serviceUser
    && uidOwners[0].gid === passwd.gid;
  const exactPrimaryUser = primaryGroupUsers.length === 1
    && primaryGroupUsers[0].user === serviceUser
    && primaryGroupUsers[0].uid === passwd.uid;
  const exactGroupMapping = namedGroupRecords.length === 1
    && namedGroupRecords[0].gid === passwd.gid
    && canonicalJson(namedGroupRecords[0].members) === canonicalJson(group.members);
  const exactExplicitMembers = group.members.every((member) => member === serviceUser);
  const exactMemberships = explicitMemberships.every((record) => (
    record.group === group.group && record.gid === group.gid
  ));
  if (passwd.user !== serviceUser
      || passwd.uid < 1
      || passwd.gid < 1
      || !exactUidOwner
      || !exactPrimaryUser
      || !exactGroupMapping
      || !exactExplicitMembers
      || !exactMemberships) {
    throw new Error(
      'production retention service identity is remapped, shared, or has supplementary groups',
    );
  }
  return {
    user: serviceUser,
    uid: passwd.uid,
    group: group.group,
    gid: passwd.gid,
    identitySources: snapshot.binding,
  };
}

export function assertRetentionServiceIdentity(
  stateRootIdentity,
  {
    identitySourceReader = readRootOwnedRetentionIdentitySource,
    requireProcess = false,
    processIdentity = null,
  } = {},
) {
  if (stateRootIdentity?.production !== true) return true;
  const expectedUser = String(stateRootIdentity.serviceUser || '');
  const expectedGroup = String(stateRootIdentity.serviceGroup || '');
  if (expectedUser !== 'cortex-retention'
      || !/^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(expectedGroup)
      || !Number.isSafeInteger(stateRootIdentity.serviceUid)
      || stateRootIdentity.serviceUid < 1
      || !Number.isSafeInteger(stateRootIdentity.serviceGid)
      || stateRootIdentity.serviceGid < 1
      || !validRetentionIdentitySourceBinding(stateRootIdentity.identitySources)) {
    throw new Error('signed production retention service identity is invalid');
  }
  const observed = resolveDedicatedRetentionServiceIdentity(
    expectedUser,
    identitySourceReader,
  );
  if (observed.uid !== stateRootIdentity.serviceUid
      || observed.gid !== stateRootIdentity.serviceGid
      || observed.group !== expectedGroup
      || canonicalJson(observed.identitySources)
        !== canonicalJson(stateRootIdentity.identitySources)) {
    throw new Error('production retention service UID/GID or normalized NSS policy changed');
  }
  if (requireProcess) {
    const credentials = processIdentity || {
      uid: process.getuid(),
      euid: process.geteuid(),
      gid: process.getgid(),
      egid: process.getegid(),
      groups: process.getgroups(),
    };
    const groups = Array.isArray(credentials.groups)
      ? credentials.groups.map(Number)
      : [];
    if (credentials.uid !== observed.uid
        || credentials.euid !== observed.uid
        || credentials.gid !== observed.gid
        || credentials.egid !== observed.gid
        || new Set(groups).size !== 1
        || groups.some((gid) => gid !== observed.gid)) {
      throw new Error(
        'retention resume process credentials do not match the signed dedicated service identity',
      );
    }
  }
  return true;
}

export function assertRetentionResumeProcessIdentity(
  stateRootIdentity,
  options = {},
) {
  if (options.requireProduction === true
      && stateRootIdentity?.production !== true) {
    throw new Error('production retention resume bootstrap identity is missing');
  }
  return assertRetentionServiceIdentity(stateRootIdentity, {
    ...options,
    requireProcess: true,
  });
}

function resolveRetentionServiceIdentity(
  serviceUser,
  fixtureOnly,
  identitySourceReader = readRootOwnedRetentionIdentitySource,
) {
  if (fixtureOnly === true) {
    return {
      user: serviceUser || 'root',
      uid: process.geteuid(),
      group: serviceUser || 'root',
      gid: process.getegid(),
      identitySources: null,
    };
  }
  const selected = serviceUser || 'cortex-retention';
  if (selected !== 'cortex-retention') {
    throw new Error(
      'production retention resume service must use the dedicated non-root identity cortex-retention',
    );
  }
  return resolveDedicatedRetentionServiceIdentity(selected, identitySourceReader);
}

function retentionExecutionServiceEntries(executionClosure, checkoutRoot) {
  const root = path.resolve(checkoutRoot);
  const entries = new Map();
  for (let ancestor = root;; ancestor = path.dirname(ancestor)) {
    entries.set(ancestor, {
      path: ancestor,
      type: 'directory',
      executable: true,
    });
    if (ancestor === '/') break;
  }
  for (const entry of executionClosure?.entries || []) {
    const target = entry.path === '.' ? root : path.join(root, entry.path);
    entries.set(target, {
      path: target,
      type: entry.type,
      executable: entry.type === 'directory' || entry.mode === '0555',
    });
  }
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function assertRetentionExecutionAccessibleToService({
  executionClosure,
  checkoutRoot,
  runtimeClosure,
  serviceUid,
  serviceGid,
  aclInspector,
}) {
  const runtimePaths = new Set(runtimeClosure.entries.map((entry) => entry.path));
  const additionalEntries = retentionExecutionServiceEntries(
    executionClosure,
    checkoutRoot,
  ).filter((entry) => !runtimePaths.has(entry.path));
  return assertProcessRuntimeClosureServiceAccess(runtimeClosure, {
    uid: serviceUid,
    gid: serviceGid,
    supplementaryGroups: [serviceGid],
    additionalEntries,
    aclInspector,
  });
}

function immutableExecutionClosureMemberSha256(
  executionClosure,
  checkoutRoot,
  targetPath,
  label,
) {
  const root = path.resolve(checkoutRoot);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target).split(path.sep).join('/');
  const file = executionClosure?.files?.find((candidate) => (
    candidate.path === relative
  ));
  const entry = executionClosure?.entries?.find((candidate) => (
    candidate.path === relative
  ));
  if (executionClosure?.immutable !== true
      || relative.length < 1
      || relative === '..'
      || relative.startsWith('../')
      || path.posix.isAbsolute(relative)
      || entry?.type !== 'file'
      || entry.uid !== 0
      || entry.gid !== 0
      || !['0444', '0555'].includes(entry.mode)
      || !DIGEST.test(String(file?.sha256 || ''))) {
    throw new Error(`${label} is absent from the immutable execution closure`);
  }
  return file.sha256;
}

function processRuntimeInterpreterSha256(runtimeClosure, executablePath) {
  const validation = validateProcessRuntimeClosure(runtimeClosure);
  const executable = runtimeClosure?.entries?.find((entry) => (
    entry.path === path.resolve(executablePath)
  ));
  if (!validation.ok
      || runtimeClosure.executablePath !== path.resolve(executablePath)
      || executable?.type !== 'file'
      || executable.role !== 'interpreter'
      || executable.uid !== 0
      || executable.gid !== 0
      || executable.mode !== '0555'
      || !DIGEST.test(String(executable.sha256 || ''))) {
    throw new Error(
      'retention resume executable is absent from the immutable process runtime closure',
    );
  }
  return executable.sha256;
}

function readStableFixtureExecutionFile(targetPath, label) {
  const target = path.resolve(targetPath);
  let descriptor = null;
  let namedDescriptor = null;
  try {
    descriptor = fs.openSync(
      target,
      RETENTION_PROTECTED_STATE_READ_FLAGS,
    );
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile()
        || before.nlink !== 1n
        || before.size < 1n
        || before.size > BigInt(RETENTION_FIXTURE_EXECUTION_FILE_MAX_BYTES)) {
      throw new Error(`${label} is not a bounded single-link regular file`);
    }
    const bytes = readExactDescriptorBytes(descriptor, Number(before.size));
    const afterRead = fs.fstatSync(descriptor, { bigint: true });
    namedDescriptor = fs.openSync(
      target,
      RETENTION_PROTECTED_STATE_READ_FLAGS,
    );
    const named = fs.fstatSync(namedDescriptor, { bigint: true });
    const committedBytes = readExactDescriptorBytes(
      descriptor,
      Number(before.size),
    );
    const committed = fs.fstatSync(descriptor, { bigint: true });
    const fields = [
      'dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size',
      'mtimeNs', 'ctimeNs', 'birthtimeNs',
    ];
    const sameIdentity = (left, right) => fields.every((field) => (
      left[field] === right[field]
    ));
    if (bytes === null
        || committedBytes === null
        || !bytes.equals(committedBytes)
        || !sameIdentity(before, afterRead)
        || !sameIdentity(afterRead, named)
        || !sameIdentity(named, committed)
        || linuxDescriptorMountId(descriptor)
          !== linuxDescriptorMountId(namedDescriptor)) {
      throw new Error(`${label} changed during its descriptor-pinned read`);
    }
    return bytes;
  } catch (error) {
    if (['ELOOP', 'ENXIO'].includes(error.code)) {
      throw new Error(`${label} is not a no-follow regular file`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    if (namedDescriptor !== null) fs.closeSync(namedDescriptor);
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

export function buildRetentionWaitContract({
  status,
  task = null,
  statePath,
  notifierPath,
  resumeBundlePath,
  releasePath,
  timerJournalPath = null,
  qualificationSecretPath,
  expectedDeployment = null,
  retentionServiceUser = null,
  identitySourceReader = readRootOwnedRetentionIdentitySource,
  createdAt,
  signingSecret,
} = {}) {
  if (!verifyRetentionStatusRecord(status, signingSecret)) {
    throw new Error('retention wait source status signature mismatch');
  }
  if (status.status !== 'not_eligible_yet'
      || !IDENTIFIER.test(String(status.subjectId || ''))
      || !Number.isFinite(Date.parse(String(status.evaluatedAt || '')))
      || !Number.isFinite(Date.parse(String(status.nextEligibleAt || '')))) {
    throw new Error('a retention wait contract requires not_eligible_yet status');
  }
  const nextWindowIndex = status.completedWindowCount + 1;
  const previousWindowDigest = status.windowEvidenceDigests.at(-1) ?? null;
  const dueTaskDigest = status.fixtureOnly === true ? null : digestRecord(task);
  const createdAtMs = Date.parse(String(createdAt || ''));
  if (!canonicalUtcTimestamp(createdAt)
      || !canonicalUtcTimestamp(status.nextEligibleAt)
      || createdAtMs < Date.parse(status.evaluatedAt)
      || createdAtMs >= Date.parse(status.nextEligibleAt)) {
    throw new Error('retention wait creation time is outside the signed status interval');
  }
  if (!SAFE_ABSOLUTE_PATH.test(String(statePath || ''))
      || !SAFE_ABSOLUTE_PATH.test(String(notifierPath || ''))
      || !SAFE_ABSOLUTE_PATH.test(String(resumeBundlePath || ''))
      || !SAFE_ABSOLUTE_PATH.test(String(releasePath || ''))
      || !SAFE_ABSOLUTE_PATH.test(String(qualificationSecretPath || ''))) {
    throw new Error('retention wait paths must be absolute');
  }
  const resolvedStatePath = path.resolve(statePath);
  const resolvedNotifierPath = path.resolve(notifierPath);
  const resolvedResumeBundlePath = path.resolve(resumeBundlePath);
  const resolvedReleasePath = path.resolve(releasePath);
  const resolvedSecretPath = path.resolve(qualificationSecretPath);
  const resolvedJournalPath = timerJournalPath === null
    ? `${resolvedStatePath}.timer-journal.json`
    : path.resolve(timerJournalPath);
  const resolvedLockPath = `${resolvedJournalPath}.lock`;
  if (resolvedJournalPath !== `${resolvedStatePath}.timer-journal.json`
      || !SAFE_ABSOLUTE_PATH.test(resolvedJournalPath)
      || !SAFE_ABSOLUTE_PATH.test(resolvedLockPath)
      || new Set([
        resolvedStatePath,
        resolvedNotifierPath,
        resolvedResumeBundlePath,
        resolvedReleasePath,
        resolvedSecretPath,
        resolvedJournalPath,
        resolvedLockPath,
      ]).size !== 7) {
    throw new Error('retention wait paths are unsafe or alias one another');
  }
  const protectedPaths = [
    resolvedStatePath,
    resolvedNotifierPath,
    resolvedResumeBundlePath,
    resolvedReleasePath,
    resolvedSecretPath,
    resolvedJournalPath,
    resolvedLockPath,
  ];
  const stateRoot = protectedPaths.reduce((common, candidate) => {
    let selected = common;
    while (candidate !== selected
        && !candidate.startsWith(`${selected}${path.sep}`)) {
      const parent = path.dirname(selected);
      if (parent === selected) return parent;
      selected = parent;
    }
    return selected;
  }, path.dirname(resolvedStatePath));
  const serviceIdentity = resolveRetentionServiceIdentity(
    retentionServiceUser,
    status.fixtureOnly === true,
    identitySourceReader,
  );
  assertRetentionServiceIdentity({
    production: status.fixtureOnly !== true,
    serviceUser: serviceIdentity.user,
    serviceUid: serviceIdentity.uid,
    serviceGroup: serviceIdentity.group,
    serviceGid: serviceIdentity.gid,
    identitySources: serviceIdentity.identitySources,
  }, { identitySourceReader });
  const stateRootChain = openRetentionStateRootChain(stateRoot, {
    production: status.fixtureOnly !== true,
    serviceUid: serviceIdentity.uid,
    serviceGid: serviceIdentity.gid,
  });
  const stateRootStat = stateRootChain.rootStat;
  const stateRootIdentity = {
    path: stateRoot,
    uid: stateRootStat.uid,
    gid: stateRootStat.gid,
    mode: '0700',
    device: stateRootStat.dev,
    inode: stateRootStat.ino,
    production: status.fixtureOnly !== true,
    serviceUser: serviceIdentity.user,
    serviceUid: serviceIdentity.uid,
    serviceGroup: serviceIdentity.group,
    serviceGid: serviceIdentity.gid,
    identitySources: serviceIdentity.identitySources,
    ancestorChainSha256: stateRootChain.ancestorChainSha256,
  };
  stateRootChain.close();
  if ((stateRootStat.mode & 0o7777) !== 0o700
      || (status.fixtureOnly !== true
        && (stateRootStat.uid !== serviceIdentity.uid
          || stateRootStat.gid !== serviceIdentity.gid))
      || protectedPaths.some((candidate) => (
        candidate !== stateRoot && !candidate.startsWith(`${stateRoot}${path.sep}`)
      ))) {
    throw new Error(
      'retention paths must share a pre-existing protected state root with a trusted ancestor chain',
    );
  }
  if (status.fixtureOnly !== true && (
    !isRecord(task)
    || task.schemaVersion !== RETENTION_TASK_SCHEMA
    || !verifySignature(task, signingSecret)
    || task.fixtureOnly !== false
    || task.subjectId !== status.subjectId
    || !isRecord(expectedDeployment)
    || canonicalJson(task.deployment)
      !== canonicalJson(sourceDeploymentBinding(expectedDeployment))
    || task.acquisitionBinding?.stateDigest !== status.acquisitionStateDigest
    || canonicalJson(task.assessmentCampaign)
      !== canonicalJson(status.campaignBinding)
    || task.windowIndex !== nextWindowIndex
    || task.previousWindowDigest !== previousWindowDigest
    || task.notBefore !== status.nextEligibleAt
  )) {
    throw new Error(
      'production retention wait due task differs from its signed status campaign, window, predecessor, or due time',
    );
  }
  const resumeEntrypoint = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    'phd-qualification-control.mjs',
  );
  const resumeCheckoutRoot = path.resolve(path.dirname(resumeEntrypoint), '..', '..');
  const resumeClosureSha256 = expectedDeployment?.closureSha256
    || (status.fixtureOnly === true ? status.deploymentDigest : null);
  if (status.fixtureOnly !== true) {
    const deploymentValidation = validateDeploymentBinding(expectedDeployment);
    if (!deploymentValidation.ok
        || deploymentBindingDigest(expectedDeployment) !== status.deploymentDigest
        || expectedDeployment.executionClosure?.immutable !== true) {
      throw new Error('retention resume deployment or immutable execution closure is invalid');
    }
    assertExecutionClosureAtRoot(expectedDeployment.executionClosure, resumeCheckoutRoot);
  }
  const helperPaths = status.fixtureOnly === true
    ? null
    : Object.fromEntries(Object.entries(RETENTION_HELPER_PATHS).map(([name, target]) => [
      name,
      fs.realpathSync.native(target),
    ]));
  const runtimeClosure = status.fixtureOnly === true
    ? null
    : buildProcessRuntimeClosure({
      executablePath: process.execPath,
      additionalExecutablePaths: Object.values(helperPaths),
      mountDirectoryPaths: [
        resumeCheckoutRoot,
        stateRoot,
        RETENTION_DURABLE_UNIT_DIRECTORY,
        '/dev',
        '/proc',
        '/run',
        '/sys',
      ],
      mountFilePaths: [
        ...Object.values(RETENTION_IDENTITY_SOURCE_PATHS),
        ...Object.values(RETENTION_RUNTIME_EXTERNAL_PATHS),
      ],
    });
  if (status.fixtureOnly !== true) {
    assertRetentionExecutionAccessibleToService({
      executionClosure: expectedDeployment.executionClosure,
      checkoutRoot: resumeCheckoutRoot,
      runtimeClosure,
      serviceUid: serviceIdentity.uid,
      serviceGid: serviceIdentity.gid,
      aclInspector: helperPaths.getfacl,
    });
  }
  const resumeExecutablePath = runtimeClosure?.executablePath || process.execPath;
  const executableSha256 = status.fixtureOnly === true
    ? sha256Bytes(readStableFixtureExecutionFile(
      resumeExecutablePath,
      'fixture retention resume executable',
    ))
    : processRuntimeInterpreterSha256(
      runtimeClosure,
      resumeExecutablePath,
    );
  const entrypointSha256 = status.fixtureOnly === true
    ? sha256Bytes(readStableFixtureExecutionFile(
      resumeEntrypoint,
      'fixture retention resume entrypoint',
    ))
    : immutableExecutionClosureMemberSha256(
      expectedDeployment.executionClosure,
      resumeCheckoutRoot,
      resumeEntrypoint,
      'retention resume entrypoint',
    );
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(serviceIdentity.user)
      || !DIGEST.test(String(resumeClosureSha256 || ''))) {
    throw new Error('retention resume executable, immutable entrypoint, service user, or closure is invalid');
  }
  return sign({
    schemaVersion: RETENTION_WAIT_SCHEMA,
    subjectId: status.subjectId,
    fixtureOnly: status.fixtureOnly,
    status: 'not_eligible_yet',
    sourceStatusDigest: digestRecord(status),
    sourceStatusSignature: structuredClone(status.controlPlaneSignature),
    campaignBinding: structuredClone(status.campaignBinding),
    deploymentDigest: status.deploymentDigest,
    acquisitionStateDigest: status.acquisitionStateDigest,
    nextWindowIndex,
    previousWindowDigest,
    dueTaskDigest,
    createdAt,
    resumeAt: status.nextEligibleAt,
    statePath: resolvedStatePath,
    resumeBundlePath: resolvedResumeBundlePath,
    releasePath: resolvedReleasePath,
    timerJournalPath: resolvedJournalPath,
    stateRootIdentity,
    notifier: {
      compatible: true,
      path: resolvedNotifierPath,
      terminalStatuses: status.fixtureOnly
        ? ['failed', 'fixture_retention_complete']
        : ['failed', 'retained_mastery_qualified'],
    },
    resumeCommand: [
      resumeExecutablePath,
      resumeEntrypoint,
      'retention-resume',
      '--bundle',
      resolvedResumeBundlePath,
      '--wait-state',
      resolvedStatePath,
      '--secret',
      resolvedSecretPath,
      ...(status.fixtureOnly === true ? [] : [
        '--expected-subject-id',
        status.subjectId,
        '--expected-campaign-id',
        status.campaignBinding.campaignId,
        '--expected-campaign-digest',
        status.campaignBinding.campaignDigest,
        '--expected-deployment-digest',
        status.deploymentDigest,
        '--expected-key-id',
        status.controlPlaneSignature.keyId,
        '--expected-window-index',
        String(nextWindowIndex),
        '--expected-previous-window-digest',
        previousWindowDigest ?? 'none',
        '--expected-task-digest',
        dueTaskDigest,
      ]),
    ],
    resumeExecution: {
      checkoutRoot: resumeCheckoutRoot,
      executablePath: resumeExecutablePath,
      executableSha256,
      entrypointPath: resumeEntrypoint,
      entrypointSha256,
      closureSha256: resumeClosureSha256,
      executionClosure: status.fixtureOnly === true
        ? null
        : structuredClone(expectedDeployment.executionClosure),
      runtimeClosure: runtimeClosure === null ? null : structuredClone(runtimeClosure),
      runtimeReadOnlyBinds: status.fixtureOnly === true
        ? null
        : [
          resumeCheckoutRoot,
          RETENTION_DURABLE_UNIT_DIRECTORY,
          ...Object.values(RETENTION_IDENTITY_SOURCE_PATHS),
          ...Object.values(RETENTION_RUNTIME_EXTERNAL_PATHS),
        ].sort(),
      runtimeReadWriteBinds: status.fixtureOnly === true ? null : [stateRoot],
      helperPaths: helperPaths === null ? null : structuredClone(helperPaths),
      serviceUser: serviceIdentity.user,
    },
    privilegedTimerBroker: {
      schemaVersion: 'cortex.learning_os.retention_timer_broker_policy.v1',
      authorization: 'local-root-only-no-polkit-delegation',
      requiredEuid: 0,
      deploymentDigest: status.deploymentDigest,
      unitDirectory: status.fixtureOnly === true
        ? path.join(stateRoot, '.retention-systemd-units')
        : RETENTION_DURABLE_UNIT_DIRECTORY,
      systemctlPath: helperPaths?.systemctl || null,
      permittedMutations: [
        'publish_exact_authenticated_unit_bytes',
        'systemctl_daemon_reload',
        'systemctl_enable_exact_timer',
      ],
    },
    chatTurnHeld: false,
    routineReviewScheduled: false,
    persisted: false,
    timerInstalled: false,
    timerReleased: false,
    truthBoundary: 'This signed wait plan becomes durable only after owner-only persistence and successful timer installation. It is not routine spaced-review selection or retention evidence.',
  }, signingSecret);
}

function openRetentionStateRootChain(stateRootPath, {
  production,
  serviceUid = null,
  serviceGid = null,
  identity = null,
} = {}) {
  if (process.platform !== 'linux' || !fs.existsSync('/proc/self/fd')) {
    throw new Error('retention protected state requires Linux descriptor-relative traversal');
  }
  if (production === true && identity !== null) {
    assertRetentionServiceIdentity(identity);
  }
  const stateRoot = path.resolve(stateRootPath);
  const descriptors = [];
  const records = [];
  const runtimeEntries = [];
  const filesystemRoot = path.parse(stateRoot).root;
  const stateRootComponents = stateRoot
    .slice(filesystemRoot.length)
    .split(path.sep)
    .filter(Boolean);
  const close = () => {
    while (descriptors.length > 0) fs.closeSync(descriptors.pop());
  };
  const runtimeDirectoryIdentity = (descriptor) => {
    const stat = fs.fstatSync(descriptor, { bigint: true });
    return {
      dev: stat.dev,
      ino: stat.ino,
      uid: stat.uid,
      gid: stat.gid,
      mode: stat.mode,
      mountId: linuxDescriptorMountId(descriptor),
    };
  };
  const sameRuntimeDirectoryIdentity = (left, right) => (
    Object.keys(left).length === Object.keys(right).length
    && Object.keys(left).every((field) => left[field] === right[field])
  );
  const productionDirectorySafe = (stat, kind) => {
    if (production !== true) return true;
    if (kind === 'state_root' || kind === 'protected_descendant') {
      return stat.uid === serviceUid
        && stat.gid === serviceGid
        && (stat.mode & 0o7777) === 0o700;
    }
    return stat.uid === 0
      && stat.gid === 0
      && (stat.mode & 0o022) === 0
      && (stat.mode & 0o001) !== 0;
  };
  const recordDescriptor = (
    descriptor,
    resolvedPath,
    kind,
    component = null,
  ) => {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isDirectory() || !productionDirectorySafe(stat, kind)) {
      throw new Error(`retention state ancestor ownership or mode is unsafe: ${resolvedPath}`);
    }
    runtimeEntries.push({
      component,
      descriptor,
      identity: runtimeDirectoryIdentity(descriptor),
      kind,
      path: resolvedPath,
    });
    records.push({
      path: resolvedPath,
      device: stat.dev,
      inode: stat.ino,
      uid: stat.uid,
      gid: stat.gid,
      mode: (stat.mode & 0o7777).toString(8).padStart(4, '0'),
    });
    return stat;
  };
  const assertNamedChain = () => {
    let namedDescriptor = fs.openSync(
      filesystemRoot,
      RETENTION_PROTECTED_STATE_DIRECTORY_FLAGS,
    );
    try {
      for (let index = 0; index < runtimeEntries.length; index += 1) {
        const retained = runtimeEntries[index];
        const retainedStat = fs.fstatSync(retained.descriptor);
        const namedStat = fs.fstatSync(namedDescriptor);
        if (!retainedStat.isDirectory()
            || !namedStat.isDirectory()
            || !productionDirectorySafe(retainedStat, retained.kind)
            || !productionDirectorySafe(namedStat, retained.kind)
            || !sameRuntimeDirectoryIdentity(
              runtimeDirectoryIdentity(retained.descriptor),
              retained.identity,
            )
            || !sameRuntimeDirectoryIdentity(
              runtimeDirectoryIdentity(namedDescriptor),
              retained.identity,
            )) {
          throw new Error(
            `retention protected state ancestor identity changed: ${retained.path}`,
          );
        }
        const next = runtimeEntries[index + 1];
        if (next === undefined) break;
        const child = fs.openSync(
          `/proc/self/fd/${namedDescriptor}/${next.component}`,
          RETENTION_PROTECTED_STATE_DIRECTORY_FLAGS,
        );
        fs.closeSync(namedDescriptor);
        namedDescriptor = child;
      }
    } catch (error) {
      if (['ELOOP', 'ENOENT', 'ENOTDIR'].includes(error.code)) {
        throw new Error(
          'retention protected state ancestor name changed during descriptor handoff',
          { cause: error },
        );
      }
      throw error;
    } finally {
      fs.closeSync(namedDescriptor);
    }
  };
  try {
    let traversed = filesystemRoot;
    let current = fs.openSync(
      filesystemRoot,
      RETENTION_PROTECTED_STATE_DIRECTORY_FLAGS,
    );
    descriptors.push(current);
    let rootStat = recordDescriptor(
      current,
      traversed,
      stateRoot === filesystemRoot ? 'state_root' : 'filesystem_ancestor',
    );
    for (const [index, component] of stateRootComponents.entries()) {
      const next = fs.openSync(
        `/proc/self/fd/${current}/${component}`,
        RETENTION_PROTECTED_STATE_DIRECTORY_FLAGS,
      );
      descriptors.push(next);
      traversed = path.join(traversed, component);
      rootStat = recordDescriptor(
        next,
        traversed,
        index === stateRootComponents.length - 1
          ? 'state_root'
          : 'filesystem_ancestor',
        component,
      );
      current = next;
    }
    const ancestorChainSha256 = sha256Text(canonicalJson(records));
    if (identity !== null && (
      !exactObjectKeys(identity, [
        'ancestorChainSha256', 'device', 'gid', 'inode', 'mode', 'path',
        'production', 'serviceGid', 'serviceGroup', 'serviceUid', 'serviceUser',
        'identitySources', 'uid',
      ])
      || path.resolve(identity.path) !== stateRoot
      || identity.production !== production
      || identity.serviceUid !== serviceUid
      || identity.serviceGid !== serviceGid
      || identity.uid !== rootStat.uid
      || identity.gid !== rootStat.gid
      || identity.device !== rootStat.dev
      || identity.inode !== rootStat.ino
      || identity.mode !== (rootStat.mode & 0o7777).toString(8).padStart(4, '0')
      || identity.ancestorChainSha256 !== ancestorChainSha256
    )) {
      throw new Error('retention state root ownership, mode, or type changed, or ancestor identity changed');
    }
    return {
      ancestorChainSha256,
      assertNamedChain,
      close,
      descriptors,
      recordProtectedDescendant(descriptor, resolvedPath, component) {
        return recordDescriptor(
          descriptor,
          resolvedPath,
          'protected_descendant',
          component,
        );
      },
      rootDescriptor: current,
      rootStat,
      rootView: `/proc/self/fd/${current}`,
    };
  } catch (error) {
    close();
    throw error;
  }
}

function openProtectedStateTarget(targetPath, stateRootIdentity, { requireFile = false } = {}) {
  const target = path.resolve(targetPath);
  const stateRoot = path.resolve(stateRootIdentity?.path || '');
  if (target === stateRoot || !target.startsWith(`${stateRoot}${path.sep}`)) {
    throw new Error('retention state path escapes the protected state root');
  }
  const chain = openRetentionStateRootChain(stateRoot, {
    production: stateRootIdentity.production,
    serviceUid: stateRootIdentity.serviceUid,
    serviceGid: stateRootIdentity.serviceGid,
    identity: stateRootIdentity,
  });
  try {
    const relative = path.relative(stateRoot, target);
    const parts = relative.split(path.sep).filter(Boolean);
    const basename = parts.pop();
    let parentDescriptor = chain.rootDescriptor;
    let traversed = stateRoot;
    for (const part of parts) {
      const descriptor = fs.openSync(
        `/proc/self/fd/${parentDescriptor}/${part}`,
        RETENTION_PROTECTED_STATE_DIRECTORY_FLAGS,
      );
      chain.descriptors.push(descriptor);
      const stat = fs.fstatSync(descriptor);
      const safeDescendant = stateRootIdentity.production
        ? stat.uid === stateRootIdentity.serviceUid
          && stat.gid === stateRootIdentity.serviceGid
          && (stat.mode & 0o7777) === 0o700
        : stat.uid === stateRootIdentity.uid
          && stat.gid === stateRootIdentity.gid
          && (stat.mode & 0o077) === 0;
      if (!stat.isDirectory() || !safeDescendant) {
        throw new Error('retention state ancestor ownership, mode, or type is unsafe');
      }
      traversed = path.join(traversed, part);
      chain.recordProtectedDescendant(descriptor, traversed, part);
      parentDescriptor = descriptor;
    }
    chain.assertNamedChain();
    const targetView = `/proc/self/fd/${parentDescriptor}/${basename}`;
    if (requireFile && !fs.existsSync(targetView)) {
      throw new Error('retention owner-only state file is missing');
    }
    return {
      ...chain,
      basename,
      parentDescriptor,
      target,
      targetView,
    };
  } catch (error) {
    chain.close();
    throw error;
  }
}

function protectedStateFileMetadataSafe(stat, stateRootIdentity) {
  if (!stat.isFile()) return false;
  const uid = Number(stat.uid);
  const gid = Number(stat.gid);
  const mode = Number(stat.mode) & 0o777;
  if (stateRootIdentity.production !== true) {
    return uid === stateRootIdentity.uid
      && gid === stateRootIdentity.gid
      && mode === 0o600;
  }
  return uid === stateRootIdentity.serviceUid
    && gid === stateRootIdentity.serviceGid
    && mode === 0o600;
}

function protectedStateFileStatSafe(stat, stateRootIdentity) {
  return Number(stat.nlink) === 1
    && protectedStateFileMetadataSafe(stat, stateRootIdentity);
}

function protectedStateFileMode(_stateRootIdentity) {
  return 0o600;
}

function recoverExactNoReplacePublication({
  descriptor,
  handle,
  expectedBytes,
  observedBytes,
  observedStat,
  stateRootIdentity,
  differentBytesMessage = 'retention state no-replace publication collided with different bytes',
}) {
  if (!protectedStateFileMetadataSafe(observedStat, stateRootIdentity)
      || !observedBytes.equals(expectedBytes)) {
    throw new Error(differentBytesMessage);
  }
  let disposition = 'adopted_exact';
  if (Number(observedStat.nlink) !== 1) {
    const temporaryPrefix = `.${handle.basename}.`;
    const temporarySuffix = '.tmp';
    const publicationNames = [];
    for (const name of fs.readdirSync(`/proc/self/fd/${handle.parentDescriptor}`)) {
      const candidate = `/proc/self/fd/${handle.parentDescriptor}/${name}`;
      const candidateStat = fs.lstatSync(candidate, { bigint: true });
      if (candidateStat.dev !== observedStat.dev || candidateStat.ino !== observedStat.ino) {
        continue;
      }
      if (name !== handle.basename
          && (!name.startsWith(temporaryPrefix)
            || !name.endsWith(temporarySuffix)
            || !/^[0-9]+\.[0-9a-f]{24}$/.test(
              name.slice(temporaryPrefix.length, -temporarySuffix.length),
            ))) {
        throw new Error('retention no-replace target has an unknown hard-link alias');
      }
      publicationNames.push(name);
    }
    if (publicationNames.length !== Number(observedStat.nlink)
        || !publicationNames.includes(handle.basename)) {
      throw new Error('retention no-replace target has an external hard-link alias');
    }
    for (const name of publicationNames) {
      if (name !== handle.basename) {
        fs.unlinkSync(`/proc/self/fd/${handle.parentDescriptor}/${name}`);
      }
    }
    disposition = 'recovered_exact';
  }
  durablyAdoptProtectedStatePublication({
    descriptor,
    handle,
    expectedBytes,
    stateRootIdentity,
    label: 'retention no-replace publication recovery',
  });
  return disposition;
}

function openProtectedStateFile(targetPath, stateRootIdentity) {
  const handle = openProtectedStateTarget(targetPath, stateRootIdentity, { requireFile: true });
  try {
    const descriptor = fs.openSync(
      handle.targetView,
      RETENTION_PROTECTED_STATE_READ_FLAGS,
    );
    const stat = fs.fstatSync(descriptor, { bigint: true });
    if (!protectedStateFileStatSafe(stat, stateRootIdentity)) {
      fs.closeSync(descriptor);
      throw new Error('retention state file ownership, mode, or type is unsafe');
    }
    return { descriptor, handle, stat };
  } catch (error) {
    handle.close();
    throw error;
  }
}

function protectedStateDescriptorIdentity(
  descriptor,
  { directory = false, stat = null } = {},
) {
  const observed = stat || fs.fstatSync(descriptor, { bigint: true });
  if ((directory && !observed.isDirectory())
      || (!directory && !observed.isFile())) {
    throw new Error(
      `retention protected state ${directory ? 'parent' : 'file'} type changed`,
    );
  }
  return {
    dev: observed.dev,
    ino: observed.ino,
    uid: observed.uid,
    gid: observed.gid,
    mode: observed.mode,
    nlink: observed.nlink,
    ...(directory ? {} : { size: observed.size }),
    mtimeNs: observed.mtimeNs,
    ctimeNs: observed.ctimeNs,
    birthtimeNs: observed.birthtimeNs,
    mountId: linuxDescriptorMountId(descriptor),
  };
}

function sameProtectedStateDescriptorIdentity(left, right) {
  return Object.keys(left).length === Object.keys(right).length
    && Object.keys(left).every((field) => left[field] === right[field]);
}

function protectedStateSnapshotPolicySafe(
  file,
  parent,
  stateRootIdentity,
) {
  const expectedUid = BigInt(stateRootIdentity.production === true
    ? stateRootIdentity.serviceUid
    : stateRootIdentity.uid);
  const expectedGid = BigInt(stateRootIdentity.production === true
    ? stateRootIdentity.serviceGid
    : stateRootIdentity.gid);
  const parentMode = parent.mode & 0o7777n;
  const parentModeSafe = stateRootIdentity.production === true
    ? parentMode === 0o700n
    : (parentMode & 0o077n) === 0n;
  return file.uid === expectedUid
    && file.gid === expectedGid
    && (file.mode & 0o7777n) === 0o600n
    && file.nlink === 1n
    && parent.uid === expectedUid
    && parent.gid === expectedGid
    && parent.nlink >= 1n
    && parentModeSafe
    && file.mountId === parent.mountId;
}

function readStableProtectedStateBytes(
  targetPath,
  stateRootIdentity,
  {
    label,
    minBytes,
    maxBytes,
    consumeBytes = null,
  },
) {
  if (consumeBytes !== null && typeof consumeBytes !== 'function') {
    throw new Error(`${label} protected consumer is invalid`);
  }
  const { descriptor, handle, stat: openedStat } = openProtectedStateFile(
    targetPath,
    stateRootIdentity,
  );
  let namedDescriptor = null;
  let finalNamedDescriptor = null;
  try {
    const parentBefore = protectedStateDescriptorIdentity(
      handle.parentDescriptor,
      { directory: true },
    );
    const opened = protectedStateDescriptorIdentity(
      descriptor,
      { stat: openedStat },
    );
    const before = protectedStateDescriptorIdentity(descriptor);
    if (!protectedStateSnapshotPolicySafe(
      before,
      parentBefore,
      stateRootIdentity,
    )
        || !sameProtectedStateDescriptorIdentity(opened, before)) {
      throw new Error(
        `${label} changed from its safe open into an unsafe snapshot baseline`,
      );
    }
    if (before.size < BigInt(minBytes) || before.size > BigInt(maxBytes)) {
      throw new Error(`${label} size is invalid`);
    }
    const bytes = readExactDescriptorBytes(descriptor, Number(before.size));
    const afterRead = protectedStateDescriptorIdentity(descriptor);
    namedDescriptor = fs.openSync(
      handle.targetView,
      RETENTION_PROTECTED_STATE_READ_FLAGS,
    );
    const named = protectedStateDescriptorIdentity(namedDescriptor);
    const committedBytes = readExactDescriptorBytes(
      descriptor,
      Number(before.size),
    );
    const committed = protectedStateDescriptorIdentity(descriptor);
    const parentAfter = protectedStateDescriptorIdentity(
      handle.parentDescriptor,
      { directory: true },
    );
    if (bytes === null
        || committedBytes === null
        || !bytes.equals(committedBytes)
        || before.mountId !== parentBefore.mountId
        || !sameProtectedStateDescriptorIdentity(before, afterRead)
        || !sameProtectedStateDescriptorIdentity(afterRead, named)
        || !sameProtectedStateDescriptorIdentity(named, committed)
        || !sameProtectedStateDescriptorIdentity(parentBefore, parentAfter)) {
      throw new Error(
        `${label} changed during its descriptor-pinned authenticated read`,
      );
    }
    handle.assertNamedChain();
    const consumed = consumeBytes === null
      ? undefined
      : consumeBytes(Buffer.from(bytes));
    if (consumed !== null
        && (typeof consumed === 'object' || typeof consumed === 'function')
        && typeof consumed.then === 'function') {
      throw new Error(`${label} protected consumer must complete synchronously`);
    }
    const finalBytes = readExactDescriptorBytes(
      descriptor,
      Number(before.size),
    );
    const finalPinned = protectedStateDescriptorIdentity(descriptor);
    try {
      finalNamedDescriptor = fs.openSync(
        handle.targetView,
        RETENTION_PROTECTED_STATE_READ_FLAGS,
      );
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(
          `${label} changed across its protected consumer handoff`,
          { cause: error },
        );
      }
      throw error;
    }
    const finalNamed = protectedStateDescriptorIdentity(
      finalNamedDescriptor,
    );
    const finalParent = protectedStateDescriptorIdentity(
      handle.parentDescriptor,
      { directory: true },
    );
    if (finalBytes === null
        || !finalBytes.equals(bytes)
        || !sameProtectedStateDescriptorIdentity(committed, finalPinned)
        || !sameProtectedStateDescriptorIdentity(finalPinned, finalNamed)
        || !sameProtectedStateDescriptorIdentity(parentAfter, finalParent)) {
      throw new Error(
        `${label} changed across its protected consumer handoff`,
      );
    }
    handle.assertNamedChain();
    return { bytes, consumed };
  } catch (error) {
    if (['ELOOP', 'ENXIO'].includes(error.code)) {
      throw new Error(`${label} is not a no-follow regular file`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    if (finalNamedDescriptor !== null) fs.closeSync(finalNamedDescriptor);
    if (namedDescriptor !== null) fs.closeSync(namedDescriptor);
    fs.closeSync(descriptor);
    handle.close();
  }
}

function strictProtectedStateUtf8(bytes, label) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw new Error(`${label} is not strict UTF-8`);
  }
  return text;
}

function parseStableProtectedStateJson(bytes, label) {
  const text = strictProtectedStateUtf8(bytes, label);
  let record;
  try {
    record = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  const compact = JSON.stringify(record);
  const pretty = JSON.stringify(record, null, 2);
  if (![compact, `${compact}\n`, pretty, `${pretty}\n`].includes(text)) {
    throw new Error(`${label} is not an exact deterministic JSON encoding`);
  }
  return record;
}

function openStableProtectedStatePublicationTarget(
  handle,
  stateRootIdentity,
  label,
) {
  let descriptor = null;
  let namedDescriptor = null;
  try {
    const parentBefore = protectedStateDescriptorIdentity(
      handle.parentDescriptor,
      { directory: true },
    );
    descriptor = fs.openSync(
      handle.targetView,
      RETENTION_PROTECTED_STATE_READ_FLAGS,
    );
    const beforeStat = fs.fstatSync(descriptor, { bigint: true });
    const before = protectedStateDescriptorIdentity(
      descriptor,
      { stat: beforeStat },
    );
    const expectedUid = BigInt(stateRootIdentity.production === true
      ? stateRootIdentity.serviceUid
      : stateRootIdentity.uid);
    const expectedGid = BigInt(stateRootIdentity.production === true
      ? stateRootIdentity.serviceGid
      : stateRootIdentity.gid);
    const parentMode = parentBefore.mode & 0o7777n;
    const parentModeSafe = stateRootIdentity.production === true
      ? parentMode === 0o700n
      : (parentMode & 0o077n) === 0n;
    if (!beforeStat.isFile()
        || before.uid !== expectedUid
        || before.gid !== expectedGid
        || (before.mode & 0o7777n) !== 0o600n
        || before.nlink < 1n
        || before.size < 1n
        || before.size > BigInt(RETENTION_PROTECTED_STATE_MAX_BYTES)
        || parentBefore.uid !== expectedUid
        || parentBefore.gid !== expectedGid
        || parentBefore.nlink < 1n
        || !parentModeSafe
        || before.mountId !== parentBefore.mountId) {
      throw new Error(`${label} ownership, mode, link count, type, mount, or size is unsafe`);
    }
    const bytes = readExactDescriptorBytes(descriptor, Number(before.size));
    const afterRead = protectedStateDescriptorIdentity(descriptor);
    namedDescriptor = fs.openSync(
      handle.targetView,
      RETENTION_PROTECTED_STATE_READ_FLAGS,
    );
    const named = protectedStateDescriptorIdentity(namedDescriptor);
    const committedBytes = readExactDescriptorBytes(
      descriptor,
      Number(before.size),
    );
    const committed = protectedStateDescriptorIdentity(descriptor);
    const parentAfter = protectedStateDescriptorIdentity(
      handle.parentDescriptor,
      { directory: true },
    );
    if (bytes === null
        || committedBytes === null
        || !bytes.equals(committedBytes)
        || !sameProtectedStateDescriptorIdentity(before, afterRead)
        || !sameProtectedStateDescriptorIdentity(afterRead, named)
        || !sameProtectedStateDescriptorIdentity(named, committed)
        || !sameProtectedStateDescriptorIdentity(parentBefore, parentAfter)) {
      throw new Error(`${label} changed during its descriptor-pinned publication read`);
    }
    handle.assertNamedChain();
    return {
      bytes,
      descriptor,
      identity: committed,
      parentIdentity: parentAfter,
      stat: beforeStat,
    };
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    if (['ELOOP', 'ENXIO'].includes(error.code)) {
      throw new Error(`${label} is not a no-follow regular file`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    if (namedDescriptor !== null) fs.closeSync(namedDescriptor);
  }
}

function durablyAdoptProtectedStatePublication({
  descriptor,
  handle,
  expectedBytes,
  stateRootIdentity,
  label,
}) {
  const parentBefore = protectedStateDescriptorIdentity(
    handle.parentDescriptor,
    { directory: true },
  );
  const pinnedBefore = protectedStateDescriptorIdentity(descriptor);
  const bytesBefore = readExactDescriptorBytes(
    descriptor,
    Number(pinnedBefore.size),
  );
  if (bytesBefore === null
      || !bytesBefore.equals(expectedBytes)
      || !protectedStateSnapshotPolicySafe(
        pinnedBefore,
        parentBefore,
        stateRootIdentity,
      )) {
    throw new Error(`${label} is not an exact safe adoption candidate`);
  }
  fs.fsyncSync(descriptor);
  fs.fsyncSync(handle.parentDescriptor);
  const pinnedAfter = protectedStateDescriptorIdentity(descriptor);
  const bytesAfter = readExactDescriptorBytes(
    descriptor,
    Number(pinnedBefore.size),
  );
  const parentAfter = protectedStateDescriptorIdentity(
    handle.parentDescriptor,
    { directory: true },
  );
  const named = openStableProtectedStatePublicationTarget(
    handle,
    stateRootIdentity,
    label,
  );
  try {
    if (bytesAfter === null
        || !bytesAfter.equals(expectedBytes)
        || !named.bytes.equals(expectedBytes)
        || !sameProtectedStateDescriptorIdentity(pinnedBefore, pinnedAfter)
        || !sameProtectedStateDescriptorIdentity(pinnedAfter, named.identity)
        || !sameProtectedStateDescriptorIdentity(parentBefore, parentAfter)
        || !sameProtectedStateDescriptorIdentity(parentAfter, named.parentIdentity)) {
      throw new Error(`${label} changed across its durability barrier`);
    }
    handle.assertNamedChain();
  } finally {
    closeStableProtectedStatePublicationTarget(named);
  }
}

function closeStableProtectedStatePublicationTarget(snapshot) {
  if (snapshot?.descriptor !== null && snapshot?.descriptor !== undefined) {
    fs.closeSync(snapshot.descriptor);
    snapshot.descriptor = null;
  }
}

function assertStableProtectedStatePublicationTarget(
  handle,
  stateRootIdentity,
  snapshot,
  label,
) {
  const pinnedBefore = protectedStateDescriptorIdentity(snapshot.descriptor);
  const pinnedBytes = readExactDescriptorBytes(
    snapshot.descriptor,
    Number(snapshot.identity.size),
  );
  const pinnedAfter = protectedStateDescriptorIdentity(snapshot.descriptor);
  const named = openStableProtectedStatePublicationTarget(
    handle,
    stateRootIdentity,
    label,
  );
  try {
    if (pinnedBytes === null
        || !pinnedBytes.equals(snapshot.bytes)
        || !named.bytes.equals(snapshot.bytes)
        || !sameProtectedStateDescriptorIdentity(
          snapshot.identity,
          pinnedBefore,
        )
        || !sameProtectedStateDescriptorIdentity(pinnedBefore, pinnedAfter)
        || !sameProtectedStateDescriptorIdentity(
          pinnedAfter,
          named.identity,
        )) {
      throw new Error(`${label} changed before its atomic publication commit`);
    }
    handle.assertNamedChain();
  } finally {
    closeStableProtectedStatePublicationTarget(named);
  }
}

function assertCommittedProtectedStatePublication(
  handle,
  stateRootIdentity,
  expectedBytes,
  label,
) {
  const committed = openStableProtectedStatePublicationTarget(
    handle,
    stateRootIdentity,
    label,
  );
  try {
    if (committed.identity.nlink !== 1n
        || !committed.bytes.equals(expectedBytes)) {
      throw new Error(`${label} differs from the exact committed successor`);
    }
    handle.assertNamedChain();
  } finally {
    closeStableProtectedStatePublicationTarget(committed);
  }
}

function atomicOwnerOnlyBytes(
  targetPath,
  bytes,
  stateRootIdentity,
  { expectedDigest = undefined, crashInjector = null } = {},
) {
  if (!Buffer.isBuffer(bytes)) {
    throw new Error('retention state publication requires an exact byte buffer');
  }
  const handle = openProtectedStateTarget(targetPath, stateRootIdentity);
  const temporaryName = `.${handle.basename}.${process.pid}.${crypto.randomBytes(12).toString('hex')}.tmp`;
  const temporary = `/proc/self/fd/${handle.parentDescriptor}/${temporaryName}`;
  let descriptor = null;
  let existingSnapshot = null;
  try {
    const targetExists = fs.existsSync(handle.targetView);
    if (targetExists) {
      existingSnapshot = openStableProtectedStatePublicationTarget(
        handle,
        stateRootIdentity,
        'retention state publication predecessor',
      );
      if (expectedDigest === null) {
        const recovered = recoverExactNoReplacePublication({
          descriptor: existingSnapshot.descriptor,
          handle,
          expectedBytes: bytes,
          observedBytes: existingSnapshot.bytes,
          observedStat: existingSnapshot.stat,
          stateRootIdentity,
          differentBytesMessage: 'retention state compare-and-swap predecessor changed',
        });
        assertCommittedProtectedStatePublication(
          handle,
          stateRootIdentity,
          bytes,
          'retention state adopted no-replace publication',
        );
        return recovered;
      }
      if (existingSnapshot.identity.nlink !== 1n) {
        throw new Error('retention state compare-and-swap predecessor changed');
      }
      if (expectedDigest !== undefined) {
        const existingRecord = parseStableProtectedStateJson(
          existingSnapshot.bytes,
          'retention state publication predecessor',
        );
        const canonicalExistingBytes = Buffer.from(
          `${JSON.stringify(existingRecord, null, 2)}\n`,
          'utf8',
        );
        if (!existingSnapshot.bytes.equals(canonicalExistingBytes)
            || digestRecord(existingRecord) !== expectedDigest) {
          throw new Error('retention state compare-and-swap predecessor changed');
        }
      }
    } else if (expectedDigest !== undefined && expectedDigest !== null) {
      throw new Error('retention state compare-and-swap predecessor is missing');
    }
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY
        | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_CLOEXEC || 0),
      protectedStateFileMode(stateRootIdentity),
    );
    fs.writeFileSync(descriptor, bytes);
    if (stateRootIdentity.production === true) {
      const temporaryStat = fs.fstatSync(descriptor);
      if (temporaryStat.uid !== stateRootIdentity.serviceUid
          || temporaryStat.gid !== stateRootIdentity.serviceGid) {
        fs.fchownSync(
          descriptor,
          stateRootIdentity.serviceUid,
          stateRootIdentity.serviceGid,
        );
      }
    }
    fs.fchmodSync(descriptor, protectedStateFileMode(stateRootIdentity));
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    handle.assertNamedChain();
    if (expectedDigest === null) {
      try {
        fs.linkSync(temporary, handle.targetView);
        injectCrash(
          crashInjector,
          'after_retention_no_replace_link_before_parent_fsync',
        );
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const collision = openStableProtectedStatePublicationTarget(
          handle,
          stateRootIdentity,
          'retention state no-replace collision',
        );
        try {
          recoverExactNoReplacePublication({
            descriptor: collision.descriptor,
            handle,
            expectedBytes: bytes,
            observedBytes: collision.bytes,
            observedStat: collision.stat,
            stateRootIdentity,
          });
        } finally {
          closeStableProtectedStatePublicationTarget(collision);
        }
        fs.unlinkSync(temporary);
        fs.fsyncSync(handle.parentDescriptor);
        assertCommittedProtectedStatePublication(
          handle,
          stateRootIdentity,
          bytes,
          'retention state adopted no-replace collision',
        );
        return 'adopted_exact';
      }
      const linked = openStableProtectedStatePublicationTarget(
        handle,
        stateRootIdentity,
        'retention state no-replace publication',
      );
      try {
        recoverExactNoReplacePublication({
          descriptor: linked.descriptor,
          handle,
          expectedBytes: bytes,
          observedBytes: linked.bytes,
          observedStat: linked.stat,
          stateRootIdentity,
        });
      } finally {
        closeStableProtectedStatePublicationTarget(linked);
      }
    } else {
      if (existingSnapshot !== null) {
        assertStableProtectedStatePublicationTarget(
          handle,
          stateRootIdentity,
          existingSnapshot,
          'retention state compare-and-swap predecessor',
        );
      }
      fs.renameSync(temporary, handle.targetView);
    }
    fs.fsyncSync(handle.parentDescriptor);
    handle.assertNamedChain();
    assertCommittedProtectedStatePublication(
      handle,
      stateRootIdentity,
      bytes,
      'retention state publication',
    );
    return 'published';
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  } finally {
    closeStableProtectedStatePublicationTarget(existingSnapshot);
    handle.close();
  }
}

function atomicOwnerOnlyJson(targetPath, value, stateRootIdentity = value?.stateRootIdentity
  || value?.timerSpec?.stateRootIdentity, {
  expectedDigest = undefined,
  crashInjector = null,
} = {}) {
  return atomicOwnerOnlyBytes(
    targetPath,
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'),
    stateRootIdentity,
    { expectedDigest, crashInjector },
  );
}

function protectedStateFileExists(targetPath, stateRootIdentity) {
  const handle = openProtectedStateTarget(targetPath, stateRootIdentity);
  try {
    const exists = fs.existsSync(handle.targetView);
    handle.assertNamedChain();
    return exists;
  } finally {
    handle.close();
  }
}

export function persistRetentionWaitContract({
  contract,
  waitPath,
  signingSecret,
  persistedAt = new Date().toISOString(),
  crashInjector = null,
} = {}) {
  const resolvedWaitPath = path.resolve(waitPath);
  if (!verifyRetentionWaitContract(contract, signingSecret)
      || contract.persisted !== false
      || contract.timerInstalled !== false
      || contract.timerReleased !== false
      || contract.statePath !== resolvedWaitPath
      || !DIGEST.test(String(contract.sourceStatusDigest || ''))
      || !validSignatureEnvelope(contract.sourceStatusSignature)
      || !Number.isFinite(Date.parse(String(persistedAt || '')))
      || new Date(Date.parse(persistedAt)).toISOString() !== persistedAt
      || Date.parse(persistedAt) < Date.parse(contract.createdAt)
      || Date.parse(persistedAt) >= Date.parse(contract.resumeAt)) {
    throw new Error('retention wait contract signature or state is invalid');
  }
  const persisted = sign({
    ...unsigned(contract),
    waitPath: resolvedWaitPath,
    persisted: true,
    persistedAt,
  }, signingSecret);
  return withAuthenticatedRetentionTimerLock(
    contract,
    signingSecret,
    () => {
      injectCrash(crashInjector, 'before_wait_publication');
      atomicOwnerOnlyJson(
        waitPath,
        persisted,
        persisted.stateRootIdentity,
        { expectedDigest: null, crashInjector },
      );
      injectCrash(crashInjector, 'after_wait_persisted_before_initial_journal');
      return persisted;
    },
  );
}

function readOwnerOnlyJson(
  targetPath,
  stateRootIdentity,
  { consume = null } = {},
) {
  if (consume !== null && typeof consume !== 'function') {
    throw new Error('retention wait state protected consumer is invalid');
  }
  let record = null;
  const snapshot = readStableProtectedStateBytes(
    targetPath,
    stateRootIdentity,
    {
      label: 'retention wait state',
      minBytes: 2,
      maxBytes: RETENTION_PROTECTED_STATE_MAX_BYTES,
      consumeBytes(bytes) {
        record = parseStableProtectedStateJson(
          bytes,
          'retention wait state',
        );
        return consume === null
          ? record
          : consume(structuredClone(record));
      },
    },
  );
  return consume === null ? record : snapshot.consumed;
}

function readOwnerOnlyBytes(
  targetPath,
  stateRootIdentity,
  { consume = null } = {},
) {
  if (consume !== null && typeof consume !== 'function') {
    throw new Error('retention protected state byte consumer is invalid');
  }
  const snapshot = readStableProtectedStateBytes(
    targetPath,
    stateRootIdentity,
    {
      label: 'retention protected state bytes',
      minBytes: 2,
      maxBytes: RETENTION_PROTECTED_STATE_MAX_BYTES,
      consumeBytes: consume,
    },
  );
  return consume === null ? snapshot.bytes : snapshot.consumed;
}

export function readRetentionProtectedJson(
  targetPath,
  stateRootIdentity,
  { consume = null } = {},
) {
  return readOwnerOnlyJson(
    targetPath,
    stateRootIdentity,
    { consume },
  );
}

export function readRetentionProtectedSecret(
  targetPath,
  stateRootIdentity,
  {
    expectedKeyId = null,
    identitySourceReader = readRootOwnedRetentionIdentitySource,
    processIdentity = null,
  } = {},
) {
  assertRetentionResumeProcessIdentity(stateRootIdentity, {
    identitySourceReader,
    processIdentity,
  });
  if (expectedKeyId !== null
      && !/^[0-9a-f]{16}$/.test(String(expectedKeyId || ''))) {
    throw new Error(
      'retention control-plane secret expected key ID is invalid',
    );
  }
  let value = null;
  readStableProtectedStateBytes(
    targetPath,
    stateRootIdentity,
    {
      label: 'retention control-plane secret',
      minBytes: 33,
      maxBytes: 4097,
      consumeBytes(bytes) {
        value = strictProtectedStateUtf8(
          bytes,
          'retention control-plane secret',
        ).trim();
        if (value.length < 32 || value.length > 4096
            || (expectedKeyId !== null
              && sha256Text(value).slice(0, 16) !== expectedKeyId)) {
          throw new Error('retention control-plane secret is invalid');
        }
        return value;
      },
    },
  );
  return value;
}

function waitBase(contract) {
  const payload = unsigned(contract);
  for (const field of [
    'sourceWaitDigest',
    'sourceInstalledWaitDigest',
    'releaseDigest',
    'releaseFileSha256',
    'timerFiredAt',
    'timerInstalledAt',
    'timerInstallationReceipt',
    'timerInstallationRevision',
    'timerReleaseReceipt',
    'timerServiceUnit',
    'timerSpecDigest',
    'timerUnit',
    'timerReleasedAt',
    'supersededInstalledWaitDigest',
  ]) delete payload[field];
  payload.timerInstalled = false;
  payload.timerReleased = false;
  return payload;
}

function retentionRuntimeIsActive(contract) {
  return contract?.fixtureOnly !== true
    && process.env.CLOS_RETENTION_RUNTIME_CLOSURE_SHA256
      === contract.resumeExecution?.runtimeClosure?.closureSha256;
}

function retentionRuntimePath(contract, logicalPath) {
  if (contract.fixtureOnly === true || retentionRuntimeIsActive(contract)) {
    return path.resolve(logicalPath);
  }
  return path.join(
    contract.resumeExecution.runtimeClosure.rootDirectory,
    path.resolve(logicalPath).slice(1),
  );
}

function assertRetentionRuntimeClosure(contract) {
  const active = retentionRuntimeIsActive(contract);
  return assertProcessRuntimeClosure(contract.resumeExecution.runtimeClosure, {
    executablePath: contract.resumeExecution.executablePath,
    requireCurrentLoadedSet: active,
    rootDirectory: active
      ? '/'
      : contract.resumeExecution.runtimeClosure.rootDirectory,
  });
}

export function assertRetentionResumeRuntimeIdentity(contract) {
  assertFixtureOnlyBoolean(contract?.fixtureOnly, 'retention wait fixtureOnly');
  if (contract?.fixtureOnly === true) return true;
  if (contract?.stateRootIdentity?.production !== true
      || !retentionRuntimeIsActive(contract)) {
    throw new Error(
      'production retention firing requires the active signed sealed runtime',
    );
  }
  return assertRetentionRuntimeClosure(contract);
}

function buildRetentionTimerSpec(contract) {
  assertRetentionServiceIdentity(contract.stateRootIdentity);
  if (contract.privilegedTimerBroker?.requiredEuid !== 0
      || contract.privilegedTimerBroker?.deploymentDigest !== contract.deploymentDigest
      || canonicalJson(contract.privilegedTimerBroker?.permittedMutations)
        !== canonicalJson([
          'publish_exact_authenticated_unit_bytes',
          'systemctl_daemon_reload',
          'systemctl_enable_exact_timer',
        ])) {
    throw new Error('retention timer privileged broker policy is invalid');
  }
  if (!Array.isArray(contract.resumeCommand) || contract.resumeCommand.length < 2
      || !SAFE_ABSOLUTE_PATH.test(String(contract.resumeCommand[0] || ''))
      || contract.resumeCommand.some((entry) => !SAFE_COMMAND_ARGUMENT.test(String(entry || '')))) {
    throw new Error('retention resume command contains an unsafe argument');
  }
  const executablePath = path.resolve(contract.resumeCommand[0]);
  const entrypointPath = path.resolve(contract.resumeCommand[1]);
  const checkoutRoot = path.resolve(contract.resumeExecution?.checkoutRoot || '');
  if (contract.fixtureOnly !== true) assertRetentionRuntimeClosure(contract);
  const executablePhysicalPath = contract.fixtureOnly === true
    ? executablePath
    : retentionRuntimePath(contract, executablePath);
  const executableSha256 = contract.fixtureOnly === true
    ? sha256Bytes(readStableFixtureExecutionFile(
      executablePhysicalPath,
      'fixture retention resume executable',
    ))
    : processRuntimeInterpreterSha256(
      contract.resumeExecution.runtimeClosure,
      executablePath,
    );
  const entrypointSha256 = contract.fixtureOnly === true
    ? sha256Bytes(readStableFixtureExecutionFile(
      entrypointPath,
      'fixture retention resume entrypoint',
    ))
    : immutableExecutionClosureMemberSha256(
      contract.resumeExecution.executionClosure,
      checkoutRoot,
      entrypointPath,
      'retention resume entrypoint',
    );
  if (executablePath !== contract.resumeExecution?.executablePath
      || entrypointPath !== contract.resumeExecution?.entrypointPath
      || entrypointPath !== path.join(
        checkoutRoot,
        'cortex-learning-os',
        'src',
        'phd-qualification-control.mjs',
      )
      || executableSha256 !== contract.resumeExecution.executableSha256
      || entrypointSha256 !== contract.resumeExecution.entrypointSha256) {
    throw new Error('retention resume executable or immutable entrypoint bytes changed');
  }
  if (contract.fixtureOnly !== true) {
    if (contract.resumeExecution.executionClosure?.closureSha256
        !== contract.resumeExecution.closureSha256
        || contract.resumeExecution.executionClosure?.immutable !== true) {
      throw new Error('retention resume signed execution closure changed');
    }
    assertExecutionClosureAtRoot(
      contract.resumeExecution.executionClosure,
      checkoutRoot,
    );
  }
  const identity = {
    schemaVersion: 'cortex.learning_os.retention_timer_identity.v1',
    subjectId: contract.subjectId,
    sourceStatusDigest: contract.sourceStatusDigest,
    sourceStatusSignature: contract.sourceStatusSignature,
    campaignBinding: contract.campaignBinding,
    deploymentDigest: contract.deploymentDigest,
    acquisitionStateDigest: contract.acquisitionStateDigest,
    nextWindowIndex: contract.nextWindowIndex,
    previousWindowDigest: contract.previousWindowDigest,
    dueTaskDigest: contract.dueTaskDigest,
    resumeAt: contract.resumeAt,
    waitPath: contract.waitPath,
    timerJournalPath: contract.timerJournalPath,
    releasePath: contract.releasePath,
    resumeCommand: contract.resumeCommand,
    resumeExecution: contract.resumeExecution,
    privilegedTimerBroker: contract.privilegedTimerBroker,
    stateRootIdentity: contract.stateRootIdentity,
  };
  const specDigest = sha256Text(canonicalJson(identity));
  const unitBase = [
    'clos-retention',
    contract.subjectId.replace(/[^A-Za-z0-9-]/g, '-'),
    specDigest.slice(0, 16),
  ].join('-');
  const unitDirectory = contract.fixtureOnly === true
    ? path.join(contract.stateRootIdentity.path, '.retention-systemd-units')
    : RETENTION_DURABLE_UNIT_DIRECTORY;
  const resumeTimestamp = new Date(contract.resumeAt).toISOString();
  const [calendarDate, calendarTime] = resumeTimestamp.slice(0, -1).split('T');
  const calendarExpression = calendarTime.endsWith('.000')
    ? `${calendarDate} ${calendarTime.slice(0, -4)} UTC`
    : `${calendarDate} ${calendarTime}000 UTC`;
  const spec = {
    schemaVersion: 'cortex.learning_os.retention_timer_spec.v1',
    specDigest,
    unitBase,
    serviceUnit: `${unitBase}.service`,
    timerUnit: `${unitBase}.timer`,
    serviceDescription: `Cortex Learning OS retention resume ${specDigest}`,
    timerDescription: `Cortex Learning OS retention timer ${specDigest}`,
    durable: true,
    transient: false,
    serviceType: 'oneshot',
    serviceRestart: 'on-failure',
    serviceRestartUSec: '5s',
    serviceGroup: String(contract.stateRootIdentity.serviceGid),
    serviceGid: contract.stateRootIdentity.serviceGid,
    serviceUid: contract.stateRootIdentity.serviceUid,
    supplementaryGroups: String(contract.stateRootIdentity.serviceGid),
    umask: '0077',
    noNewPrivileges: true,
    privateTmp: true,
    protectSystem: 'strict',
    readWritePaths: contract.stateRootIdentity.path,
    rootDirectory: contract.fixtureOnly === true
      ? null
      : contract.resumeExecution.runtimeClosure.rootDirectory,
    mountApiVfs: contract.fixtureOnly !== true,
    bindReadOnlyPaths: contract.fixtureOnly === true
      ? []
      : [...contract.resumeExecution.runtimeReadOnlyBinds],
    bindReadWritePaths: contract.fixtureOnly === true
      ? []
      : [...contract.resumeExecution.runtimeReadWriteBinds],
    collectMode: 'inactive',
    accuracyUSec: '1s',
    persistent: true,
    resumeAt: contract.resumeAt,
    calendarExpression,
    timerJournalPath: contract.timerJournalPath,
    releasePath: contract.releasePath,
    command: [...contract.resumeCommand],
    resumeExecution: structuredClone(contract.resumeExecution),
    stateRootIdentity: structuredClone(contract.stateRootIdentity),
    serviceUser: String(contract.stateRootIdentity.serviceUid),
    environment: [
      `CLOS_RETENTION_TIMER_SPEC_SHA256=${specDigest}`,
      ...(contract.fixtureOnly === true ? [] : [
        `CLOS_RETENTION_RUNTIME_CLOSURE_SHA256=${
          contract.resumeExecution.runtimeClosure.closureSha256
        }`,
      ]),
      'LANG=C',
      'LC_ALL=C',
      'PATH=/usr/bin:/bin',
      'TZ=UTC',
    ],
    unsetEnvironment: [
      'BASH_ENV',
      'ENV',
      'LD_AUDIT',
      'LD_LIBRARY_PATH',
      'LD_PRELOAD',
      'NODE_OPTIONS',
      'NODE_PATH',
      'PYTHONPATH',
    ].join(' '),
    unitDirectory,
    serviceUnitPath: path.join(unitDirectory, `${unitBase}.service`),
    timerUnitPath: path.join(unitDirectory, `${unitBase}.timer`),
  };
  const serviceUnitBytes = retentionServiceUnitBytes(spec);
  const timerUnitBytes = retentionTimerUnitBytes(spec);
  spec.serviceUnitBytes = serviceUnitBytes.length;
  spec.serviceUnitSha256 = sha256Bytes(serviceUnitBytes);
  spec.timerUnitBytes = timerUnitBytes.length;
  spec.timerUnitSha256 = sha256Bytes(timerUnitBytes);
  return spec;
}

function systemdQuote(value) {
  if (typeof value !== 'string' || value.length < 1 || /[\0\r\n]/.test(value)) {
    throw new Error('retention timer systemd argument is invalid');
  }
  return `"${value.replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function retentionServiceUnitBytes(spec) {
  const rootIsolation = spec.rootDirectory === null
    ? []
    : [
      `RootDirectory=${systemdQuote(spec.rootDirectory)}`,
      `MountAPIVFS=${String(spec.mountApiVfs)}`,
      `BindReadOnlyPaths=${spec.bindReadOnlyPaths.map(systemdQuote).join(' ')}`,
      `BindPaths=${spec.bindReadWritePaths.map(systemdQuote).join(' ')}`,
    ];
  return Buffer.from([
    '[Unit]',
    `Description=${spec.serviceDescription}`,
    `CollectMode=${spec.collectMode}`,
    '',
    '[Service]',
    `Type=${spec.serviceType}`,
    `User=${spec.serviceUser}`,
    `Group=${spec.serviceGroup}`,
    `SupplementaryGroups=${spec.supplementaryGroups}`,
    `UMask=${spec.umask}`,
    `ExecStart=${spec.command.map(systemdQuote).join(' ')}`,
    `Restart=${spec.serviceRestart}`,
    `RestartSec=${spec.serviceRestartUSec}`,
    `NoNewPrivileges=${String(spec.noNewPrivileges)}`,
    `PrivateTmp=${String(spec.privateTmp)}`,
    `ProtectSystem=${spec.protectSystem}`,
    ...rootIsolation,
    `ReadWritePaths=${systemdQuote(spec.readWritePaths)}`,
    'CapabilityBoundingSet=',
    `Environment=${spec.environment.map(systemdQuote).join(' ')}`,
    `UnsetEnvironment=${spec.unsetEnvironment}`,
    '',
  ].join('\n'), 'utf8');
}

function retentionTimerUnitBytes(spec) {
  return Buffer.from([
    '[Unit]',
    `Description=${spec.timerDescription}`,
    `CollectMode=${spec.collectMode}`,
    '',
    '[Timer]',
    `Unit=${spec.serviceUnit}`,
    `OnCalendar=${spec.calendarExpression}`,
    `AccuracySec=${spec.accuracyUSec}`,
    `Persistent=${String(spec.persistent)}`,
    '',
    '[Install]',
    'WantedBy=timers.target',
    '',
  ].join('\n'), 'utf8');
}

function parseSystemctlProperties(stdout) {
  const properties = {};
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('systemctl returned an invalid unit property');
    const key = line.slice(0, separator);
    if (Object.hasOwn(properties, key)) throw new Error(`systemctl repeated unit property: ${key}`);
    properties[key] = line.slice(separator + 1);
  }
  return properties;
}

function inspectSystemdUnit(systemctl, unit, properties, commandRunner) {
  const result = commandRunner(systemctl, [
    'show',
    unit,
    '--no-pager',
    ...properties.map((property) => `--property=${property}`),
  ], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin', TZ: 'UTC' },
  });
  if (result.error) throw new Error(`retention timer inspection failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`retention timer inspection failed: ${result.stderr || result.stdout || result.status}`);
  }
  const observed = parseSystemctlProperties(result.stdout);
  if (observed.LoadState === 'not-found') {
    if (observed.Id !== unit) {
      throw new Error('retention timer absent-unit inspection identity mismatch');
    }
    return { exists: false, observed };
  }
  return { exists: true, observed };
}

function exactSystemdExecRecords(value, optionField) {
  if (!['flags', 'ignore_errors'].includes(optionField)) {
    throw new Error('unsupported systemd execution option field');
  }
  const source = String(value || '').trim();
  if (source === '') return [];
  const records = [];
  let remainder = source;
  const recordPattern = new RegExp(
    '^\\{ path=([^;]*?) ; argv\\[\\]=([^;]*?) ; '
      + `${optionField}=([^;]*?) ; `
      + 'start_time=\\[([^\\]]*)\\] ; stop_time=\\[([^\\]]*)\\] ; '
      + 'pid=([0-9]+) ; code=([^;]*?) ; status=([^}]*?) \\}(?:\\s+|$)',
  );
  while (remainder !== '') {
    const match = recordPattern.exec(remainder);
    if (!match) return null;
    const commandPath = match[1].trim();
    const argvText = match[2].trim();
    const option = match[3].trim();
    const argv = argvText === '' ? [] : argvText.split(' ');
    if (!SAFE_ABSOLUTE_PATH.test(commandPath)
        || argv.length < 1
        || argv.some((entry) => !SAFE_COMMAND_ARGUMENT.test(entry))
        || argv.join(' ') !== argvText) {
      return null;
    }
    records.push({
      path: commandPath,
      argv,
      option,
      startTime: match[4],
      stopTime: match[5],
      pid: match[6],
      code: match[7].trim(),
      status: match[8].trim(),
    });
    remainder = remainder.slice(match[0].length);
  }
  return records;
}

function systemdUnitObjectPath(unit) {
  if (!/^[A-Za-z0-9_.@-]+[.]service$/.test(String(unit || ''))) {
    throw new Error('retention service unit name is unsafe');
  }
  const encoded = [...unit].map((character) => (
    /^[A-Za-z0-9]$/.test(character)
      ? character
      : `_${character.charCodeAt(0).toString(16).padStart(2, '0')}`
  )).join('');
  return `/org/freedesktop/systemd1/unit/${encoded}`;
}

function inspectSystemdExecStartEx(busctl, unit, commandRunner) {
  const result = commandRunner(busctl, [
    '--json=short',
    'get-property',
    'org.freedesktop.systemd1',
    systemdUnitObjectPath(unit),
    'org.freedesktop.systemd1.Service',
    'ExecStartEx',
  ], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin', TZ: 'UTC' },
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `retention service command inspection failed: ${
        result.error?.message || result.stderr || result.stdout || result.status
      }`,
    );
  }
  let payload;
  try {
    payload = JSON.parse(String(result.stdout || ''));
  } catch {
    return null;
  }
  if (!exactKeys(payload, ['type', 'data'])
      || payload.type !== 'a(sasasttttuii)'
      || !Array.isArray(payload.data)) {
    return null;
  }
  const records = [];
  for (const record of payload.data) {
    if (!Array.isArray(record)
        || record.length !== 10
        || !SAFE_ABSOLUTE_PATH.test(String(record[0] || ''))
        || !Array.isArray(record[1])
        || record[1].length < 1
        || record[1].some((argument) => typeof argument !== 'string')
        || !Array.isArray(record[2])
        || record[2].some((flag) => typeof flag !== 'string')
        || record.slice(3, 8).some(
          (value) => !Number.isSafeInteger(value) || value < 0,
        )
        || record.slice(8).some((value) => !Number.isSafeInteger(value))) {
      return null;
    }
    records.push({
      path: record[0],
      argv: [...record[1]],
      flags: [...record[2]],
      runtime: [...record.slice(3)],
    });
  }
  return records;
}

function exactSystemdCalendarExpressions(value) {
  const source = String(value || '').trim();
  if (source === '') return [];
  const expressions = [];
  let remainder = source;
  while (remainder !== '') {
    const match = /^\{\s*OnCalendar=(.*?)\s*;\s*next_elapse=.*?\s*\}(?:\s+|$)/.exec(
      remainder,
    );
    if (!match || match[1].trim() === '') return null;
    expressions.push(match[1].trim());
    remainder = remainder.slice(match[0].length);
  }
  return expressions;
}

const RETENTION_SERVICE_INSPECTION_PROPERTIES = Object.freeze([
  'Id', 'InvocationID', 'LoadState', 'Transient', 'Description', 'Type',
  'MainPID', 'ControlPID',
  'ExecStart', 'ExecStartEx',
  'Environment', 'ActiveState', 'SubState', 'CollectMode', 'Restart', 'RestartUSec',
  'User', 'Group', 'SupplementaryGroups', 'UMask',
  'NoNewPrivileges', 'PrivateTmp', 'ProtectSystem',
  'RootDirectory', 'MountAPIVFS', 'BindReadOnlyPaths', 'BindPaths',
  'ReadWritePaths', 'CapabilityBoundingSet', 'FragmentPath', 'UnitFileState',
  'DropInPaths', 'NeedDaemonReload', 'ExecCondition', 'ExecStartPre',
  'ExecStartPost', 'ExecReload', 'ExecStop', 'ExecStopPost', 'EnvironmentFiles', 'PassEnvironment',
  'UnsetEnvironment',
]);

const RETENTION_TIMER_INSPECTION_PROPERTIES = Object.freeze([
  'Id', 'InvocationID', 'LoadState', 'Transient', 'Description', 'Unit',
  'ActiveState', 'SubState',
  'AccuracyUSec', 'Persistent', 'NextElapseUSecRealtime', 'LastTriggerUSec',
  'CollectMode', 'FragmentPath', 'UnitFileState', 'DropInPaths', 'NeedDaemonReload',
  'TimersCalendar', 'TimersMonotonic', 'NextElapseUSecMonotonic',
  'OnClockChange', 'OnTimezoneChange', 'RandomizedDelayUSec',
  'FixedRandomDelay', 'WakeSystem', 'RemainAfterElapse',
]);

function evaluateRetentionTimerInspection(
  spec,
  {
    service,
    timer,
    allowFired = false,
    allowLegacyManagerPid = false,
  },
) {
  if (!service.exists && !timer.exists) {
    return {
      exists: false,
      exact: false,
      identityExact: false,
      activationExact: false,
      mismatches: [],
      identityMismatches: [],
      activationMismatches: [],
    };
  }
  const identityMismatches = [];
  const activationMismatches = [];
  if (!service.exists || !timer.exists) {
    identityMismatches.push('service/timer presence differs');
  }
  if (service.exists) {
    const dbusExecStartEx = service.observed.ExecStartExDbus;
    const serviceInvocationId = String(service.observed.InvocationID || '');
    if (serviceInvocationId !== '' && !/^[0-9a-f]{32}$/.test(serviceInvocationId)) {
      identityMismatches.push('service InvocationID mismatch');
    }
    if (!allowLegacyManagerPid
        && (!/^(?:0|[1-9][0-9]*)$/.test(String(
          service.observed.MainPID || '',
        ))
        || !/^(?:0|[1-9][0-9]*)$/.test(String(
          service.observed.ControlPID || '',
        )))) {
      identityMismatches.push('service manager PID identity mismatch');
    }
    const expected = {
      Id: spec.serviceUnit,
      LoadState: 'loaded',
      Transient: spec.transient ? 'yes' : 'no',
      Description: spec.serviceDescription,
      Type: spec.serviceType,
      Restart: spec.serviceRestart,
      RestartUSec: spec.serviceRestartUSec,
      CollectMode: spec.collectMode,
      User: spec.serviceUser,
      Group: spec.serviceGroup,
      SupplementaryGroups: spec.supplementaryGroups,
      UMask: spec.umask,
      NoNewPrivileges: spec.noNewPrivileges ? 'yes' : 'no',
      PrivateTmp: spec.privateTmp ? 'yes' : 'no',
      ProtectSystem: spec.protectSystem,
      RootDirectory: spec.rootDirectory || '',
      MountAPIVFS: spec.mountApiVfs ? 'yes' : 'no',
      BindReadOnlyPaths: spec.bindReadOnlyPaths.join(' '),
      BindPaths: spec.bindReadWritePaths.join(' '),
      ReadWritePaths: spec.readWritePaths,
      CapabilityBoundingSet: '',
      FragmentPath: spec.serviceUnitPath,
      UnitFileState: 'static',
      DropInPaths: '',
      NeedDaemonReload: 'no',
      ExecCondition: '',
      ExecStartPre: '',
      ExecStartPost: '',
      ExecReload: '',
      ExecStop: '',
      ExecStopPost: '',
      EnvironmentFiles: '',
      PassEnvironment: '',
      UnsetEnvironment: spec.unsetEnvironment,
    };
    for (const [property, value] of Object.entries(expected)) {
      if (service.observed[property] !== value) {
        identityMismatches.push(`service ${property} mismatch`);
      }
    }
    const execStart = exactSystemdExecRecords(
      service.observed.ExecStart,
      'ignore_errors',
    );
    if (execStart === null) {
      identityMismatches.push('service ExecStart is not exactly parseable');
    } else if (execStart.length !== 1) {
      identityMismatches.push('service ExecStart record count mismatch');
    } else {
      if (execStart[0].path !== spec.command[0]) {
        identityMismatches.push('service ExecStart path mismatch');
      }
      if (canonicalJson(execStart[0].argv) !== canonicalJson(spec.command)) {
        identityMismatches.push('service ExecStart argv mismatch');
      }
      if (execStart[0].option !== 'no') {
        identityMismatches.push('service ExecStart ignore_errors mismatch');
      }
    }
    const execStartEx = exactSystemdExecRecords(
      service.observed.ExecStartEx,
      'flags',
    );
    if (execStartEx === null) {
      identityMismatches.push('service ExecStartEx is not exactly parseable');
    } else if (execStartEx.length !== 1) {
      identityMismatches.push('service ExecStartEx record count mismatch');
    } else {
      if (execStartEx[0].path !== spec.command[0]) {
        identityMismatches.push('service ExecStartEx path mismatch');
      }
      if (canonicalJson(execStartEx[0].argv) !== canonicalJson(spec.command)) {
        identityMismatches.push('service ExecStartEx argv mismatch');
      }
      if (execStartEx[0].option !== '') {
        identityMismatches.push('service ExecStartEx flags mismatch');
      }
    }
    if (dbusExecStartEx === null) {
      identityMismatches.push('service D-Bus ExecStartEx is not exactly parseable');
    } else if (dbusExecStartEx.length !== 1) {
      identityMismatches.push('service D-Bus ExecStartEx record count mismatch');
    } else {
      if (dbusExecStartEx[0].path !== spec.command[0]) {
        identityMismatches.push('service D-Bus ExecStartEx path mismatch');
      }
      if (canonicalJson(dbusExecStartEx[0].argv) !== canonicalJson(spec.command)) {
        identityMismatches.push('service D-Bus ExecStartEx argv mismatch');
      }
      if (dbusExecStartEx[0].flags.length !== 0) {
        identityMismatches.push('service D-Bus ExecStartEx flags mismatch');
      }
    }
    if (!allowFired) {
      if (service.observed.ActiveState !== 'inactive') {
        identityMismatches.push('service premature ActiveState');
      }
      if (service.observed.SubState !== 'dead') {
        identityMismatches.push('service premature SubState');
      }
    }
    const environment = String(service.observed.Environment || '').replace(/^"(.*)"$/, '$1');
    if (environment !== spec.environment.join(' ')) {
      identityMismatches.push('service Environment mismatch');
    }
  }
  if (timer.exists) {
    const timerInvocationId = String(timer.observed.InvocationID || '');
    const timerHasAuthorityGeneration = timer.observed.ActiveState === 'active'
      || Number.isFinite(Date.parse(String(timer.observed.LastTriggerUSec || '')));
    if ((timerHasAuthorityGeneration && !/^[0-9a-f]{32}$/.test(timerInvocationId))
        || (!timerHasAuthorityGeneration
          && timerInvocationId !== ''
          && !/^[0-9a-f]{32}$/.test(timerInvocationId))) {
      identityMismatches.push('timer InvocationID mismatch');
    }
    const expected = {
      Id: spec.timerUnit,
      LoadState: 'loaded',
      Transient: spec.transient ? 'yes' : 'no',
      Description: spec.timerDescription,
      Unit: spec.serviceUnit,
      AccuracyUSec: spec.accuracyUSec,
      Persistent: spec.persistent ? 'yes' : 'no',
      CollectMode: spec.collectMode,
      FragmentPath: spec.timerUnitPath,
      DropInPaths: '',
      NeedDaemonReload: 'no',
      TimersMonotonic: '',
      NextElapseUSecMonotonic: '0',
      OnClockChange: 'no',
      OnTimezoneChange: 'no',
      RandomizedDelayUSec: '0',
      FixedRandomDelay: 'no',
      WakeSystem: 'no',
      RemainAfterElapse: 'yes',
    };
    for (const [property, value] of Object.entries(expected)) {
      if (timer.observed[property] !== value) {
        identityMismatches.push(`timer ${property} mismatch`);
      }
    }
    const calendarExpressions = exactSystemdCalendarExpressions(
      timer.observed.TimersCalendar,
    );
    if (canonicalJson(calendarExpressions) !== canonicalJson([spec.calendarExpression])) {
      identityMismatches.push('timer TimersCalendar mismatch');
    }
    if (timer.observed.UnitFileState !== 'enabled') {
      activationMismatches.push('timer UnitFileState mismatch');
    }
    if (!allowFired) {
      const waiting = timer.observed.ActiveState === 'active'
        && timer.observed.SubState === 'waiting';
      if (timer.observed.ActiveState !== 'active') {
        activationMismatches.push('timer ActiveState mismatch');
      }
      if (timer.observed.SubState !== 'waiting') {
        activationMismatches.push('timer SubState mismatch');
      }
      const nextElapseMs = Date.parse(String(timer.observed.NextElapseUSecRealtime || ''));
      if (!Number.isFinite(nextElapseMs)
          || nextElapseMs !== Date.parse(spec.resumeAt)) {
        (waiting ? identityMismatches : activationMismatches)
          .push('timer calendar mismatch');
      }
      if (!['', 'n/a'].includes(String(timer.observed.LastTriggerUSec || ''))) {
        identityMismatches.push('timer premature LastTriggerUSec');
      }
    } else if (![
      'active:elapsed',
      'active:running',
      'active:waiting',
      'inactive:dead',
    ].includes(`${timer.observed.ActiveState}:${timer.observed.SubState}`)) {
      activationMismatches.push('timer fired lifecycle mismatch');
    } else if (timer.observed.ActiveState === 'inactive'
        && timer.observed.SubState === 'dead'
        && !Number.isFinite(Date.parse(String(timer.observed.LastTriggerUSec || '')))) {
      activationMismatches.push('timer inactive without firing evidence');
    }
  }
  const mismatches = [...identityMismatches, ...activationMismatches];
  return {
    exists: true,
    exact: mismatches.length === 0,
    identityExact: identityMismatches.length === 0,
    activationExact: activationMismatches.length === 0,
    mismatches,
    identityMismatches,
    activationMismatches,
    service: service.observed,
    timer: timer.observed,
    inspectionDigest: sha256Text(canonicalJson({
      service: service.observed,
      timer: timer.observed,
    })),
  };
}

function inspectRetentionTimerSnapshot(
  spec,
  {
    systemctl,
    busctl,
    commandRunner,
    allowFired = false,
  },
) {
  const service = inspectSystemdUnit(
    systemctl,
    spec.serviceUnit,
    RETENTION_SERVICE_INSPECTION_PROPERTIES,
    commandRunner,
  );
  const timer = inspectSystemdUnit(
    systemctl,
    spec.timerUnit,
    RETENTION_TIMER_INSPECTION_PROPERTIES,
    commandRunner,
  );
  if (service.exists) {
    service.observed.ExecStartExDbus = inspectSystemdExecStartEx(
      busctl,
      spec.serviceUnit,
      commandRunner,
    );
  }
  return evaluateRetentionTimerInspection(spec, {
    service,
    timer,
    allowFired,
  });
}

function inspectRetentionTimer(spec, options) {
  const initial = inspectRetentionTimerSnapshot(spec, options);
  const confirmed = inspectRetentionTimerSnapshot(spec, options);
  if (canonicalJson(initial) !== canonicalJson(confirmed)) {
    throw new Error(
      'retention timer manager changed during one coherent inspection',
    );
  }
  return confirmed;
}

function retentionTimerInspectionEvidenceValid(
  evidence,
  spec,
  { allowFired },
) {
  const serviceProperties = [
    ...RETENTION_SERVICE_INSPECTION_PROPERTIES,
    'ExecStartExDbus',
  ];
  const legacyServiceProperties = serviceProperties.filter(
    (property) => !['MainPID', 'ControlPID'].includes(property),
  );
  const completeServiceInspection = exactObjectKeys(
    evidence?.inspection?.service,
    serviceProperties,
  );
  const legacyServiceInspection = exactObjectKeys(
    evidence?.inspection?.service,
    legacyServiceProperties,
  );
  if (!exactObjectKeys(evidence?.inspection, ['service', 'timer'])
      || (!completeServiceInspection && !legacyServiceInspection)
      || !exactObjectKeys(
        evidence.inspection.timer,
        RETENTION_TIMER_INSPECTION_PROPERTIES,
      )
      || !DIGEST.test(String(evidence.inspectionDigest || ''))) {
    return false;
  }
  const validation = evaluateRetentionTimerInspection(spec, {
    service: {
      exists: true,
      observed: structuredClone(evidence.inspection.service),
    },
    timer: {
      exists: true,
      observed: structuredClone(evidence.inspection.timer),
    },
    allowFired,
    allowLegacyManagerPid: legacyServiceInspection,
  });
  return validation.exact
    && validation.inspectionDigest === evidence.inspectionDigest;
}

function inspectedTimerFiredAt(inspection, spec, observedAt) {
  if (!inspection.exact || inspection.timer?.SubState === 'waiting') return null;
  const firedAtMs = Date.parse(String(inspection.timer?.LastTriggerUSec || ''));
  if (!Number.isFinite(firedAtMs)
      || firedAtMs < Date.parse(spec.resumeAt)
      || firedAtMs > Date.parse(observedAt)) {
    return null;
  }
  return new Date(firedAtMs).toISOString();
}

function durableUnitOwner(spec) {
  return spec.stateRootIdentity.production === true
    ? { uid: 0, gid: 0 }
    : { uid: spec.stateRootIdentity.uid, gid: spec.stateRootIdentity.gid };
}

function durableUnitDirectoryMode(stat) {
  return (stat.mode & 0o7777n).toString(8).padStart(4, '0');
}

function durableUnitDirectoryEvidence(spec, descriptor, stat) {
  return {
    path: spec.unitDirectory,
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mountId: linuxDescriptorMountId(descriptor),
    uid: Number(stat.uid),
    gid: Number(stat.gid),
    mode: durableUnitDirectoryMode(stat),
    nlink: stat.nlink.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
    birthtimeNs: stat.birthtimeNs.toString(),
  };
}

function sameDurableUnitDirectoryIdentity(left, right) {
  return left.path === right.path
    && left.device === right.device
    && left.inode === right.inode
    && left.mountId === right.mountId
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
    && left.birthtimeNs === right.birthtimeNs;
}

function openDurableUnitDirectoryHandle(spec, { create = false } = {}) {
  if (spec.unitDirectory !== RETENTION_DURABLE_UNIT_DIRECTORY
      && spec.stateRootIdentity.production === true) {
    throw new Error('production retention timer units are outside durable systemd storage');
  }
  if (process.platform !== 'linux' || !fs.existsSync('/proc/self/fd')) {
    throw new Error('durable retention timer units require Linux descriptor traversal');
  }
  const resolved = path.resolve(spec.unitDirectory);
  const filesystemRoot = path.parse(resolved).root;
  const components = resolved.slice(filesystemRoot.length).split(path.sep).filter(Boolean);
  const flags = fs.constants.O_RDONLY
    | (fs.constants.O_DIRECTORY || 0)
    | (fs.constants.O_NOFOLLOW || 0)
    | (fs.constants.O_CLOEXEC || 0);
  const owner = durableUnitOwner(spec);
  let descriptor = fs.openSync(filesystemRoot, flags);
  let traversed = filesystemRoot;
  try {
    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      const targetView = `/proc/self/fd/${descriptor}/${component}`;
      let child;
      try {
        child = fs.openSync(targetView, flags);
      } catch (error) {
        const finalComponent = index === components.length - 1;
        if (error.code !== 'ENOENT'
            || create !== true
            || spec.stateRootIdentity.production === true
            || !finalComponent) {
          throw error;
        }
        fs.mkdirSync(targetView, { mode: 0o700 });
        fs.fsyncSync(descriptor);
        child = fs.openSync(targetView, flags);
      }
      fs.closeSync(descriptor);
      descriptor = child;
      traversed = path.join(traversed, component);
      const enforce = spec.stateRootIdentity.production === true
        || traversed === spec.stateRootIdentity.path
        || traversed === spec.unitDirectory
        || traversed.startsWith(`${spec.stateRootIdentity.path}/`);
      if (!enforce) continue;
      const stat = fs.fstatSync(descriptor, { bigint: true });
      if (!stat.isDirectory()
          || stat.nlink < 1n
          || stat.uid !== BigInt(owner.uid)
          || stat.gid !== BigInt(owner.gid)
          || (stat.mode & 0o022n) !== 0n
          || (traversed === spec.unitDirectory
            && spec.stateRootIdentity.production !== true
            && (stat.mode & 0o7777n) !== 0o700n)) {
        throw new Error(`durable retention timer unit ancestor is unsafe: ${traversed}`);
      }
    }
    const stat = fs.fstatSync(descriptor, { bigint: true });
    if (!stat.isDirectory()
        || stat.nlink < 1n
        || stat.uid !== BigInt(owner.uid)
        || stat.gid !== BigInt(owner.gid)
        || (stat.mode & 0o022n) !== 0n) {
      throw new Error('durable retention timer unit directory is unsafe');
    }
    return {
      descriptor,
      evidence: durableUnitDirectoryEvidence(spec, descriptor, stat),
    };
  } catch (error) {
    fs.closeSync(descriptor);
    if (error.code === 'ENOENT') {
      throw new Error('durable retention timer unit directory is missing');
    }
    throw error;
  }
}

function assertNamedDurableUnitDirectoryIdentity(spec, expected) {
  const named = openDurableUnitDirectoryHandle(spec);
  try {
    if (!sameDurableUnitDirectoryIdentity(expected, named.evidence)) {
      throw new Error('durable retention timer unit directory identity changed');
    }
  } finally {
    fs.closeSync(named.descriptor);
  }
}

function durableUnitDescriptorEntry(handle, name) {
  return `/proc/self/fd/${handle.descriptor}/${name}`;
}

function durableUnitNamedEntryExists(handle, name) {
  try {
    fs.lstatSync(durableUnitDescriptorEntry(handle, name));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function durableUnitFileObservation(
  handle,
  unitPath,
  expectedBytes,
  expectedSha256,
  spec,
  requireSingleLink = true,
) {
  if (path.dirname(unitPath) !== spec.unitDirectory
      || !Buffer.isBuffer(expectedBytes)
      || sha256Bytes(expectedBytes) !== expectedSha256) {
    throw new Error('durable retention timer unit expectation is invalid');
  }
  let descriptor = null;
  let namedDescriptor = null;
  try {
    const unitView = durableUnitDescriptorEntry(handle, path.basename(unitPath));
    descriptor = fs.openSync(
      unitView,
      RETENTION_DURABLE_UNIT_READ_FLAGS,
    );
    const before = fs.fstatSync(descriptor, { bigint: true });
    const beforeMountId = linuxDescriptorMountId(descriptor);
    if (!before.isFile()
        || before.nlink < 1n
        || (requireSingleLink && before.nlink !== 1n)
        || beforeMountId !== handle.evidence.mountId
        || Number(before.uid) !== durableUnitOwner(spec).uid
        || Number(before.gid) !== durableUnitOwner(spec).gid
        || (Number(before.mode) & 0o7777) !== 0o644
        || before.size !== BigInt(expectedBytes.length)) {
      return null;
    }
    const bytes = readExactDescriptorBytes(descriptor, expectedBytes.length);
    const after = fs.fstatSync(descriptor, { bigint: true });
    namedDescriptor = fs.openSync(
      unitView,
      RETENTION_DURABLE_UNIT_READ_FLAGS,
    );
    const named = fs.fstatSync(namedDescriptor, { bigint: true });
    const namedMountId = linuxDescriptorMountId(namedDescriptor);
    if (bytes === null
        || !bytes.equals(expectedBytes)
        || sha256Bytes(bytes) !== expectedSha256
        || after.dev !== before.dev
        || after.ino !== before.ino
        || after.uid !== before.uid
        || after.gid !== before.gid
        || after.mode !== before.mode
        || after.nlink !== before.nlink
        || after.size !== before.size
        || after.mtimeNs !== before.mtimeNs
        || after.ctimeNs !== before.ctimeNs
        || after.birthtimeNs !== before.birthtimeNs
        || named.dev !== after.dev
        || named.ino !== after.ino
        || named.uid !== after.uid
        || named.gid !== after.gid
        || named.mode !== after.mode
        || named.nlink !== after.nlink
        || named.size !== after.size
        || named.mtimeNs !== after.mtimeNs
        || named.ctimeNs !== after.ctimeNs
        || named.birthtimeNs !== after.birthtimeNs) {
      return null;
    }
    if (namedMountId !== beforeMountId) return null;
    fs.closeSync(namedDescriptor);
    namedDescriptor = null;
    const committedBytes = readExactDescriptorBytes(
      descriptor,
      expectedBytes.length,
    );
    const committed = fs.fstatSync(descriptor, { bigint: true });
    if (committedBytes === null
        || !committedBytes.equals(expectedBytes)
        || sha256Bytes(committedBytes) !== expectedSha256
        || committed.dev !== after.dev
        || committed.ino !== after.ino
        || committed.uid !== after.uid
        || committed.gid !== after.gid
        || committed.mode !== after.mode
        || committed.nlink !== after.nlink
        || committed.size !== after.size
        || committed.mtimeNs !== after.mtimeNs
        || committed.ctimeNs !== after.ctimeNs
        || committed.birthtimeNs !== after.birthtimeNs) {
      return null;
    }
    return {
      path: unitPath,
      device: before.dev.toString(),
      inode: before.ino.toString(),
      mountId: beforeMountId,
      uid: Number(before.uid),
      gid: Number(before.gid),
      mode: (Number(before.mode) & 0o7777).toString(8).padStart(4, '0'),
      nlink: before.nlink.toString(),
      bytes: Number(before.size),
      mtimeNs: before.mtimeNs.toString(),
      ctimeNs: before.ctimeNs.toString(),
      birthtimeNs: before.birthtimeNs.toString(),
      sha256: expectedSha256,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally {
    if (namedDescriptor !== null) fs.closeSync(namedDescriptor);
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function readExactDescriptorBytes(descriptor, expectedLength) {
  const bytes = Buffer.alloc(expectedLength);
  let offset = 0;
  while (offset < bytes.length) {
    const read = fs.readSync(
      descriptor,
      bytes,
      offset,
      bytes.length - offset,
      offset,
    );
    if (read === 0) break;
    offset += read;
  }
  const extra = Buffer.alloc(1);
  const extraBytes = fs.readSync(
    descriptor,
    extra,
    0,
    1,
    expectedLength,
  );
  if (offset !== expectedLength || extraBytes !== 0) return null;
  return bytes;
}

function openPinnedDurableUnitFile(handle, unitPath) {
  try {
    return fs.openSync(
      durableUnitDescriptorEntry(handle, path.basename(unitPath)),
      RETENTION_DURABLE_UNIT_READ_FLAGS,
    );
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`durable retention timer unit is missing: ${unitPath}`);
    }
    throw error;
  }
}

function observePinnedDurableUnitFile(
  descriptor,
  handle,
  unitPath,
  expectedBytes,
  expectedSha256,
  spec,
) {
  const before = fs.fstatSync(descriptor, { bigint: true });
  const beforeMountId = linuxDescriptorMountId(descriptor);
  if (!before.isFile()
      || before.nlink !== 1n
      || beforeMountId !== handle.evidence.mountId
      || Number(before.uid) !== durableUnitOwner(spec).uid
      || Number(before.gid) !== durableUnitOwner(spec).gid
      || (Number(before.mode) & 0o7777) !== 0o644
      || before.size !== BigInt(expectedBytes.length)) {
    throw new Error(
      'durable retention timer unit changed during exact observation with pinned descriptors',
    );
  }
  const bytes = readExactDescriptorBytes(descriptor, expectedBytes.length);
  const after = fs.fstatSync(descriptor, { bigint: true });
  const named = durableUnitFileObservation(
    handle,
    unitPath,
    expectedBytes,
    expectedSha256,
    spec,
  );
  const committedBytes = readExactDescriptorBytes(
    descriptor,
    expectedBytes.length,
  );
  const committed = fs.fstatSync(descriptor, { bigint: true });
  if (named === null
      || bytes === null
      || !bytes.equals(expectedBytes)
      || sha256Bytes(bytes) !== expectedSha256
      || committedBytes === null
      || !committedBytes.equals(expectedBytes)
      || sha256Bytes(committedBytes) !== expectedSha256
      || !before.isFile()
      || before.dev.toString() !== named.device
      || before.ino.toString() !== named.inode
      || beforeMountId !== named.mountId
      || Number(before.uid) !== named.uid
      || Number(before.gid) !== named.gid
      || (Number(before.mode) & 0o7777).toString(8).padStart(4, '0') !== named.mode
      || before.nlink.toString() !== named.nlink
      || Number(before.size) !== named.bytes
      || before.mtimeNs.toString() !== named.mtimeNs
      || before.ctimeNs.toString() !== named.ctimeNs
      || before.birthtimeNs.toString() !== named.birthtimeNs
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.uid !== before.uid
      || after.gid !== before.gid
      || after.mode !== before.mode
      || after.nlink !== before.nlink
      || after.size !== before.size
      || after.mtimeNs !== before.mtimeNs
      || after.ctimeNs !== before.ctimeNs
      || after.birthtimeNs !== before.birthtimeNs
      || committed.dev !== after.dev
      || committed.ino !== after.ino
      || committed.uid !== after.uid
      || committed.gid !== after.gid
      || committed.mode !== after.mode
      || committed.nlink !== after.nlink
      || committed.size !== after.size
      || committed.mtimeNs !== after.mtimeNs
      || committed.ctimeNs !== after.ctimeNs
      || committed.birthtimeNs !== after.birthtimeNs) {
    throw new Error(
      'durable retention timer unit changed during exact observation with pinned descriptors',
    );
  }
  return named;
}

function durableUnitStagingObservation(
  handle,
  name,
  expectedBytes,
  expectedSha256,
  spec,
) {
  let descriptor = null;
  let namedDescriptor = null;
  try {
    const stagingView = durableUnitDescriptorEntry(handle, name);
    descriptor = fs.openSync(
      stagingView,
      RETENTION_DURABLE_UNIT_READ_FLAGS,
    );
    const before = fs.fstatSync(descriptor, { bigint: true });
    const beforeMountId = linuxDescriptorMountId(descriptor);
    const mode = before.mode & 0o7777n;
    if (!before.isFile()
        || ![1n, 2n].includes(before.nlink)
        || beforeMountId !== handle.evidence.mountId
        || before.uid !== BigInt(durableUnitOwner(spec).uid)
        || before.gid !== BigInt(durableUnitOwner(spec).gid)
        || ![0o600n, 0o644n].includes(mode)
        || before.size > BigInt(expectedBytes.length)) {
      throw new Error(
        `durable retention timer unit has an unsafe staging entry: ${name}`,
      );
    }
    const bytes = readExactDescriptorBytes(descriptor, Number(before.size));
    const after = fs.fstatSync(descriptor, { bigint: true });
    namedDescriptor = fs.openSync(
      stagingView,
      RETENTION_DURABLE_UNIT_READ_FLAGS,
    );
    const named = fs.fstatSync(namedDescriptor, { bigint: true });
    const namedMountId = linuxDescriptorMountId(namedDescriptor);
    if (bytes === null
        || BigInt(bytes.length) !== before.size
        || after.dev !== before.dev
        || after.ino !== before.ino
        || after.uid !== before.uid
        || after.gid !== before.gid
        || after.mode !== before.mode
        || after.nlink !== before.nlink
        || after.size !== before.size
        || after.mtimeNs !== before.mtimeNs
        || after.ctimeNs !== before.ctimeNs
        || after.birthtimeNs !== before.birthtimeNs
        || named.dev !== after.dev
        || named.ino !== after.ino
        || named.uid !== after.uid
        || named.gid !== after.gid
        || named.mode !== after.mode
        || named.nlink !== after.nlink
        || named.size !== after.size
        || named.mtimeNs !== after.mtimeNs
        || named.ctimeNs !== after.ctimeNs
        || named.birthtimeNs !== after.birthtimeNs) {
      throw new Error(
        `durable retention timer unit has an unsafe staging entry: ${name}`,
      );
    }
    if (namedMountId !== beforeMountId) {
      throw new Error(
        `durable retention timer unit has an unsafe staging mount: ${name}`,
      );
    }
    const exact = mode === 0o644n
      && bytes.equals(expectedBytes)
      && sha256Bytes(bytes) === expectedSha256;
    if (mode === 0o644n && !exact) {
      throw new Error(
        `durable retention timer unit has a corrupted sealed staging entry: ${name}`,
      );
    }
    return {
      name,
      dev: before.dev.toString(),
      ino: before.ino.toString(),
      mountId: beforeMountId,
      nlink: before.nlink,
      exact,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally {
    if (namedDescriptor !== null) fs.closeSync(namedDescriptor);
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function durableUnitStagingEntries(
  handle,
  unitPath,
  expectedBytes,
  expectedSha256,
  spec,
) {
  const prefix = `.${path.basename(unitPath)}.staging-`;
  const names = fs.readdirSync(`/proc/self/fd/${handle.descriptor}`)
    .filter((name) => name.startsWith(prefix))
    .sort();
  const entries = [];
  for (const name of names) {
    if (!new RegExp(`^\\.${path.basename(unitPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.staging-[0-9a-f]{32}$`).test(name)) {
      throw new Error(`durable retention timer unit has an unsafe staging entry: ${name}`);
    }
    const entry = durableUnitStagingObservation(
      handle,
      name,
      expectedBytes,
      expectedSha256,
      spec,
    );
    if (entry !== null) entries.push(entry);
  }
  return entries;
}

function unlinkDurableUnitEntry(handle, name) {
  fs.unlinkSync(durableUnitDescriptorEntry(handle, name));
}

function fsyncObservedDurableUnit(handle, unitPath, observation) {
  const descriptor = fs.openSync(
    durableUnitDescriptorEntry(handle, path.basename(unitPath)),
    RETENTION_DURABLE_UNIT_READ_FLAGS,
  );
  try {
    const stat = fs.fstatSync(descriptor, { bigint: true });
    const mountId = linuxDescriptorMountId(descriptor);
    if (!stat.isFile()
        || stat.dev.toString() !== observation.device
        || stat.ino.toString() !== observation.inode
        || mountId !== observation.mountId
        || mountId !== handle.evidence.mountId
        || Number(stat.uid) !== observation.uid
        || Number(stat.gid) !== observation.gid
        || (Number(stat.mode) & 0o7777).toString(8).padStart(4, '0')
          !== observation.mode
        || stat.nlink.toString() !== observation.nlink
        || Number(stat.size) !== observation.bytes
        || stat.mtimeNs.toString() !== observation.mtimeNs
        || stat.ctimeNs.toString() !== observation.ctimeNs
        || stat.birthtimeNs.toString() !== observation.birthtimeNs) {
      throw new Error(`durable retention timer unit changed before fsync: ${unitPath}`);
    }
    fs.fsyncSync(descriptor);
    fs.fsyncSync(handle.descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function reconcileDurableUnitPublication(
  handle,
  unitPath,
  bytes,
  expectedSha256,
  spec,
) {
  const finalObservation = durableUnitFileObservation(
    handle,
    unitPath,
    bytes,
    expectedSha256,
    spec,
    false,
  );
  const staging = durableUnitStagingEntries(
    handle,
    unitPath,
    bytes,
    expectedSha256,
    spec,
  );
  if (finalObservation === null) {
    if (durableUnitNamedEntryExists(handle, path.basename(unitPath))) {
      throw new Error(`durable retention timer unit exists with different bytes: ${unitPath}`);
    }
    const exact = staging.filter((entry) => entry.exact);
    if (exact.length === 0) return false;
    fs.linkSync(
      durableUnitDescriptorEntry(handle, exact[0].name),
      durableUnitDescriptorEntry(handle, path.basename(unitPath)),
    );
  }
  const published = durableUnitFileObservation(
    handle,
    unitPath,
    bytes,
    expectedSha256,
    spec,
    false,
  );
  if (published === null) {
    throw new Error(`durable retention timer unit recovery failed: ${unitPath}`);
  }
  fsyncObservedDurableUnit(handle, unitPath, published);
  const currentStaging = durableUnitStagingEntries(
    handle,
    unitPath,
    bytes,
    expectedSha256,
    spec,
  );
  const aliases = currentStaging.filter(
    (entry) => entry.dev === published.device && entry.ino === published.inode,
  );
  const independent = currentStaging.filter((entry) => !aliases.includes(entry));
  if (BigInt(published.nlink) !== BigInt(aliases.length + 1)
      || independent.some((entry) => entry.nlink !== 1n)) {
    throw new Error(`durable retention timer unit has an unknown hard link: ${unitPath}`);
  }
  for (const entry of currentStaging) {
    try {
      unlinkDurableUnitEntry(handle, entry.name);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const finalized = durableUnitFileObservation(
    handle,
    unitPath,
    bytes,
    expectedSha256,
    spec,
  );
  if (finalized === null) {
    throw new Error(`durable retention timer unit recovery failed: ${unitPath}`);
  }
  fsyncObservedDurableUnit(handle, unitPath, finalized);
  const finalizedDirectory = durableUnitDirectoryEvidence(
    spec,
    handle.descriptor,
    fs.fstatSync(handle.descriptor, { bigint: true }),
  );
  assertNamedDurableUnitDirectoryIdentity(spec, finalizedDirectory);
  return true;
}

function failAfterDiscardingDurableUnitStage(
  handle,
  stagingName,
  originalError,
) {
  try {
    try {
      unlinkDurableUnitEntry(handle, stagingName);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    fs.fsyncSync(handle.descriptor);
  } catch (cleanupError) {
    throw new AggregateError(
      [originalError, cleanupError],
      `could not durably discard uncommitted durable retention unit stage: ${stagingName}`,
    );
  }
  throw originalError;
}

function publishDurableUnitFile(
  handle,
  unitPath,
  bytes,
  expectedSha256,
  spec,
  crashInjector,
  crashLabel,
) {
  if (reconcileDurableUnitPublication(
    handle,
    unitPath,
    bytes,
    expectedSha256,
    spec,
  )) return true;
  if (durableUnitNamedEntryExists(handle, path.basename(unitPath))) {
    throw new Error(`durable retention timer unit exists with different bytes: ${unitPath}`);
  }
  const stagingName = `.${path.basename(unitPath)}.staging-${
    crypto.randomBytes(16).toString('hex')
  }`;
  const stagingView = durableUnitDescriptorEntry(handle, stagingName);
  let descriptor = null;
  let injectingStageCreateCrash = false;
  try {
    descriptor = fs.openSync(
      stagingView,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY
        | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_CLOEXEC || 0),
      0o600,
    );
    injectingStageCreateCrash = true;
    injectCrash(crashInjector, `after_${crashLabel}_unit_stage_create`);
    injectingStageCreateCrash = false;
    fs.writeFileSync(descriptor, bytes);
    fs.fchmodSync(descriptor, 0o644);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.fsyncSync(handle.descriptor);
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    if (!injectingStageCreateCrash) {
      failAfterDiscardingDurableUnitStage(handle, stagingName, error);
    }
    throw error;
  }
  injectCrash(crashInjector, `after_${crashLabel}_unit_stage_fsync`);
  try {
    fs.linkSync(
      stagingView,
      durableUnitDescriptorEntry(handle, path.basename(unitPath)),
    );
  } catch (error) {
    failAfterDiscardingDurableUnitStage(handle, stagingName, error);
  }
  injectCrash(crashInjector, `after_${crashLabel}_unit_link`);
  const linked = durableUnitFileObservation(
    handle,
    unitPath,
    bytes,
    expectedSha256,
    spec,
    false,
  );
  if (linked === null) {
    throw new Error(`durable retention timer unit link is unsafe: ${unitPath}`);
  }
  fsyncObservedDurableUnit(handle, unitPath, linked);
  injectCrash(crashInjector, `after_${crashLabel}_unit_link_fsync`);
  reconcileDurableUnitPublication(
    handle,
    unitPath,
    bytes,
    expectedSha256,
    spec,
  );
  injectCrash(crashInjector, `after_${crashLabel}_unit_finalize_fsync`);
  return false;
}

function publishDurableTimerUnits(spec, crashInjector = null) {
  const handle = openDurableUnitDirectoryHandle(spec, { create: true });
  try {
    const serviceBytes = retentionServiceUnitBytes(spec);
    const timerBytes = retentionTimerUnitBytes(spec);
    const adoptedService = publishDurableUnitFile(
      handle,
      spec.serviceUnitPath,
      serviceBytes,
      spec.serviceUnitSha256,
      spec,
      crashInjector,
      'service',
    );
    const adoptedTimer = publishDurableUnitFile(
      handle,
      spec.timerUnitPath,
      timerBytes,
      spec.timerUnitSha256,
      spec,
      crashInjector,
      'timer',
    );
    const finalizedDirectory = durableUnitDirectoryEvidence(
      spec,
      handle.descriptor,
      fs.fstatSync(handle.descriptor, { bigint: true }),
    );
    assertNamedDurableUnitDirectoryIdentity(spec, finalizedDirectory);
    return {
      adopted: adoptedService && adoptedTimer,
      serviceUnitSha256: spec.serviceUnitSha256,
      timerUnitSha256: spec.timerUnitSha256,
    };
  } finally {
    fs.closeSync(handle.descriptor);
  }
}

function durableUnitDropInPaths(spec) {
  const paths = [];
  for (const unitPath of [spec.serviceUnitPath, spec.timerUnitPath]) {
    const unitName = path.basename(unitPath);
    const extensionOffset = unitName.lastIndexOf('.');
    if (path.dirname(unitPath) !== spec.unitDirectory
        || extensionOffset < 1
        || extensionOffset === unitName.length - 1) {
      throw new Error('durable retention timer unit drop-in identity is invalid');
    }
    const stem = unitName.slice(0, extensionOffset);
    const extension = unitName.slice(extensionOffset);
    paths.push(path.join(spec.unitDirectory, `${unitName}.d`));
    for (let offset = stem.indexOf('-');
      offset >= 0;
      offset = stem.indexOf('-', offset + 1)) {
      paths.push(path.join(
        spec.unitDirectory,
        `${stem.slice(0, offset + 1)}${extension}.d`,
      ));
    }
    paths.push(path.join(spec.unitDirectory, `${extension.slice(1)}.d`));
  }
  return [...new Set(paths)].sort();
}

function durableUnitDropInObservation(spec, handle) {
  const observation = {
    allAbsent: true,
    applicablePaths: durableUnitDropInPaths(spec),
    searchRoot: spec.unitDirectory,
  };
  for (const candidatePath of observation.applicablePaths) {
    try {
      fs.lstatSync(
        durableUnitDescriptorEntry(handle, path.basename(candidatePath)),
      );
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    throw new Error(
      `durable retention timer unit drop-in path must be absent: ${candidatePath}`,
    );
  }
  return observation;
}

function durableUnitDropInObservationValid(observation, spec) {
  return exactObjectKeys(observation, [
    'allAbsent', 'applicablePaths', 'searchRoot',
  ])
    && observation.allAbsent === true
    && observation.searchRoot === spec.unitDirectory
    && canonicalJson(observation.applicablePaths)
      === canonicalJson(durableUnitDropInPaths(spec));
}

function legacyDurableUnitAccessBinding(spec) {
  const production = spec.stateRootIdentity.production === true;
  const runtimeClosure = spec.resumeExecution?.runtimeClosure;
  if (production && (
    spec.rootDirectory !== runtimeClosure?.rootDirectory
    || spec.bindReadOnlyPaths.filter(
      (candidate) => candidate === spec.unitDirectory,
    ).length !== 1
  )) {
    throw new Error(
      'production durable retention timer unit observation lacks its sealed read-only bind',
    );
  }
  return {
    schemaVersion: 'cortex.learning_os.retention_durable_unit_access.v1',
    accessMode: production
      ? 'sealed_root_read_only_bind'
      : 'descriptor_relative_fixture',
    bindPath: production ? spec.unitDirectory : null,
    rootDirectory: production ? spec.rootDirectory : null,
    runtimeClosureSha256: production ? runtimeClosure.closureSha256 : null,
    serviceUid: spec.serviceUid,
  };
}

function legacyDurableUnitAccessBindingValid(binding, spec) {
  try {
    return exactObjectKeys(binding, [
      'accessMode', 'bindPath', 'rootDirectory', 'runtimeClosureSha256',
      'schemaVersion', 'serviceUid',
    ])
      && canonicalJson(binding)
        === canonicalJson(legacyDurableUnitAccessBinding(spec));
  } catch {
    return false;
  }
}

function durableUnitAccessBinding(spec, directoryDescriptor, directory) {
  const production = spec.stateRootIdentity.production === true;
  const runtimeClosure = spec.resumeExecution?.runtimeClosure;
  const runtimeActive = production
    && process.env.CLOS_RETENTION_RUNTIME_CLOSURE_SHA256
      === runtimeClosure?.closureSha256;
  if (production && (
    spec.rootDirectory !== runtimeClosure?.rootDirectory
    || spec.bindReadOnlyPaths.filter(
      (candidate) => candidate === spec.unitDirectory,
    ).length !== 1
  )) {
    throw new Error(
      'production durable retention timer unit observation lacks its sealed read-only bind',
    );
  }
  const mountAccess = linuxDescriptorMountAccess(directoryDescriptor);
  if (mountAccess.mountId !== directory.mountId) {
    throw new Error(
      'durable retention timer unit access mount differs from its pinned directory',
    );
  }
  if (runtimeActive && (
    mountAccess.readOnly !== true
    || mountAccess.mountPoint !== spec.unitDirectory
  )) {
    throw new Error(
      'sealed retention runtime does not observe the durable unit directory through its exact read-only bind',
    );
  }
  return {
    schemaVersion: 'cortex.learning_os.retention_durable_unit_access.v2',
    accessMode: production
      ? (runtimeActive
        ? 'sealed_root_read_only_bind'
        : 'privileged_host_descriptor')
      : 'descriptor_relative_fixture',
    bindPath: production ? spec.unitDirectory : null,
    rootDirectory: production ? spec.rootDirectory : null,
    runtimeClosureSha256: production ? runtimeClosure.closureSha256 : null,
    serviceUid: spec.serviceUid,
    observedMountId: mountAccess.mountId,
    observedMountPoint: mountAccess.mountPoint,
    mountReadOnly: mountAccess.readOnly,
  };
}

function durableUnitAccessBindingValid(binding, spec, directory) {
  const production = spec.stateRootIdentity.production === true;
  const runtimeClosure = spec.resumeExecution?.runtimeClosure;
  return exactObjectKeys(binding, [
    'accessMode', 'bindPath', 'mountReadOnly', 'observedMountId',
    'observedMountPoint', 'rootDirectory', 'runtimeClosureSha256',
    'schemaVersion', 'serviceUid',
  ])
    && binding.schemaVersion
      === 'cortex.learning_os.retention_durable_unit_access.v2'
    && binding.bindPath === (production ? spec.unitDirectory : null)
    && binding.rootDirectory === (production ? spec.rootDirectory : null)
    && binding.runtimeClosureSha256
      === (production ? runtimeClosure?.closureSha256 : null)
    && binding.serviceUid === spec.serviceUid
    && binding.observedMountId === directory.mountId
    && /^[1-9][0-9]*$/.test(String(binding.observedMountId || ''))
    && typeof binding.observedMountPoint === 'string'
    && binding.observedMountPoint.startsWith('/')
    && typeof binding.mountReadOnly === 'boolean'
    && (production
      ? (
        ['privileged_host_descriptor', 'sealed_root_read_only_bind']
          .includes(binding.accessMode)
        && (binding.accessMode !== 'sealed_root_read_only_bind'
          || (binding.mountReadOnly === true
            && binding.observedMountPoint === spec.unitDirectory))
      )
      : binding.accessMode === 'descriptor_relative_fixture');
}

function durableUnitAccessPublicationIdentity(binding) {
  if (binding === undefined) return null;
  return {
    family: binding.bindPath === null ? 'fixture' : 'production',
    bindPath: binding.bindPath,
    rootDirectory: binding.rootDirectory,
    runtimeClosureSha256: binding.runtimeClosureSha256,
    serviceUid: binding.serviceUid,
  };
}

function durableUnitFiredAccessValid(observation, spec) {
  return spec.stateRootIdentity.production === true
    ? observation.accessBinding.accessMode === 'sealed_root_read_only_bind'
      && observation.accessBinding.mountReadOnly === true
      && observation.accessBinding.observedMountPoint === spec.unitDirectory
    : observation.accessBinding.accessMode === 'descriptor_relative_fixture';
}

function legacyDurableUnitDropInObservationValid(observation, spec) {
  return exactObjectKeys(observation, [
    'serviceAbsent', 'servicePath', 'timerAbsent', 'timerPath',
  ])
    && observation.servicePath === `${spec.serviceUnitPath}.d`
    && observation.serviceAbsent === true
    && observation.timerPath === `${spec.timerUnitPath}.d`
    && observation.timerAbsent === true;
}

function durableUnitObservationPayload(
  spec,
  accessBinding,
  directory,
  dropIns,
  service,
  timer,
) {
  return {
    schemaVersion: 'cortex.learning_os.retention_durable_unit_observation.v9',
    timerSpecDigest: spec.specDigest,
    accessBinding,
    directory,
    dropIns,
    service,
    timer,
  };
}

function legacyDurableUnitObservationV8Payload(
  spec,
  accessBinding,
  directory,
  dropIns,
  service,
  timer,
) {
  return {
    schemaVersion: 'cortex.learning_os.retention_durable_unit_observation.v8',
    timerSpecDigest: spec.specDigest,
    accessBinding,
    directory,
    dropIns,
    service,
    timer,
  };
}

function legacyDurableUnitObservationV7Payload(
  spec,
  accessBinding,
  directory,
  dropIns,
  service,
  timer,
) {
  return {
    schemaVersion: 'cortex.learning_os.retention_durable_unit_observation.v7',
    timerSpecDigest: spec.specDigest,
    accessBinding,
    directory,
    dropIns,
    service,
    timer,
  };
}

function legacyDurableUnitObservationV6Payload(
  spec,
  accessBinding,
  directory,
  dropIns,
  service,
  timer,
) {
  return {
    schemaVersion: 'cortex.learning_os.retention_durable_unit_observation.v6',
    timerSpecDigest: spec.specDigest,
    accessBinding,
    directory,
    dropIns,
    service,
    timer,
  };
}

function legacyDurableUnitObservationV5Payload(
  spec,
  directory,
  dropIns,
  service,
  timer,
) {
  return {
    schemaVersion: 'cortex.learning_os.retention_durable_unit_observation.v5',
    timerSpecDigest: spec.specDigest,
    directory,
    dropIns,
    service,
    timer,
  };
}

function legacyDurableUnitObservationV4Payload(
  spec,
  directory,
  dropIns,
  service,
  timer,
) {
  return {
    schemaVersion: 'cortex.learning_os.retention_durable_unit_observation.v4',
    timerSpecDigest: spec.specDigest,
    directory,
    dropIns,
    service,
    timer,
  };
}

function legacyDurableUnitObservationPayload(
  spec,
  directory,
  service,
  timer,
) {
  return {
    schemaVersion: 'cortex.learning_os.retention_durable_unit_observation.v3',
    timerSpecDigest: spec.specDigest,
    directory,
    service,
    timer,
  };
}

function durableUnitPublicationIdentity(observation) {
  const {
    mountId: _directoryMountId,
    mtimeNs: _directoryMtimeNs,
    ctimeNs: _directoryCtimeNs,
    birthtimeNs: _directoryBirthtimeNs,
    ...directory
  } = observation.directory;
  const {
    mountId: _serviceMountId,
    ...service
  } = observation.service;
  const {
    mountId: _timerMountId,
    ...timer
  } = observation.timer;
  return {
    timerSpecDigest: observation.timerSpecDigest,
    directory,
    service,
    timer,
  };
}

function sameDurableUnitPublicationIdentity(left, right) {
  if (canonicalJson(durableUnitPublicationIdentity(left))
      !== canonicalJson(durableUnitPublicationIdentity(right))) {
    return false;
  }
  const directoryTimeFields = ['mtimeNs', 'ctimeNs', 'birthtimeNs'];
  const leftHasDirectoryTimes = directoryTimeFields.every((field) => (
    Object.hasOwn(left.directory, field)
  ));
  const rightHasDirectoryTimes = directoryTimeFields.every((field) => (
    Object.hasOwn(right.directory, field)
  ));
  if (leftHasDirectoryTimes
      && rightHasDirectoryTimes
      && directoryTimeFields.some((field) => (
        left.directory[field] !== right.directory[field]
      ))) {
    return false;
  }
  if (left.accessBinding !== undefined
      && right.accessBinding !== undefined
      && canonicalJson(durableUnitAccessPublicationIdentity(left.accessBinding))
        !== canonicalJson(durableUnitAccessPublicationIdentity(right.accessBinding))) {
    return false;
  }
  if (left.dropIns === undefined || right.dropIns === undefined
      || canonicalJson(left.dropIns) === canonicalJson(right.dropIns)) {
    return true;
  }
  const compatibleLegacyAndComplete = (legacy, complete) => (
    exactObjectKeys(legacy, [
      'serviceAbsent', 'servicePath', 'timerAbsent', 'timerPath',
    ])
    && legacy.serviceAbsent === true
    && legacy.timerAbsent === true
    && exactObjectKeys(complete, [
      'allAbsent', 'applicablePaths', 'searchRoot',
    ])
    && complete.allAbsent === true
    && Array.isArray(complete.applicablePaths)
    && [legacy.servicePath, legacy.timerPath].every(
      (candidate) => complete.applicablePaths.includes(candidate),
    )
  );
  return compatibleLegacyAndComplete(left.dropIns, right.dropIns)
    || compatibleLegacyAndComplete(right.dropIns, left.dropIns);
}

function revalidateDurableTimerUnitPublication(
  spec,
  expectedObservation,
  crashInjector = null,
  criticalSection = null,
  handoffSection = null,
) {
  if (!durableUnitObservationValid(expectedObservation, spec)) {
    throw new Error(
      'authenticated durable retention timer unit observation is invalid',
    );
  }
  if (criticalSection !== null && typeof criticalSection !== 'function') {
    throw new Error('durable retention timer unit critical section is invalid');
  }
  if ((criticalSection === null) !== (handoffSection === null)
      || (handoffSection !== null && typeof handoffSection !== 'function')) {
    throw new Error(
      'durable retention timer unit successor requires paired commit and protected handoff sections',
    );
  }
  const validateCurrent = (observation) => {
    if (!durableUnitObservationValid(observation, spec)
        || !sameDurableUnitPublicationIdentity(
          expectedObservation,
          observation,
        )) {
      throw new Error(
        'durable retention timer unit publication changed after authenticated inspection',
      );
    }
  };
  const currentObservation = observeDurableTimerUnits(
    spec,
    crashInjector,
    criticalSection === null
      ? null
      : (observation, assertPinnedPublication) => {
        validateCurrent(observation);
        criticalSection(observation, assertPinnedPublication);
      },
    handoffSection === null
      ? null
      : (observation, assertPinnedPublication) => {
        validateCurrent(observation);
        return handoffSection(observation, assertPinnedPublication);
      },
  );
  validateCurrent(currentObservation);
  return currentObservation;
}

function observeDurableTimerUnits(
  spec,
  crashInjector = null,
  criticalSection = null,
  handoffSection = null,
) {
  if (criticalSection !== null && typeof criticalSection !== 'function') {
    throw new Error('durable retention timer unit critical section is invalid');
  }
  if ((criticalSection === null) !== (handoffSection === null)
      || (handoffSection !== null && typeof handoffSection !== 'function')) {
    throw new Error(
      'durable retention timer unit successor requires paired commit and protected handoff sections',
    );
  }
  const handle = openDurableUnitDirectoryHandle(spec);
  let serviceDescriptor = null;
  let timerDescriptor = null;
  let protectedHandoffCompleted = criticalSection === null;
  try {
    const serviceBytes = retentionServiceUnitBytes(spec);
    const timerBytes = retentionTimerUnitBytes(spec);
    const initialDropIns = durableUnitDropInObservation(spec, handle);
    serviceDescriptor = openPinnedDurableUnitFile(
      handle,
      spec.serviceUnitPath,
    );
    injectCrash(crashInjector, 'after_durable_service_unit_open');
    timerDescriptor = openPinnedDurableUnitFile(
      handle,
      spec.timerUnitPath,
    );
    injectCrash(crashInjector, 'after_durable_timer_unit_open');
    const initialService = observePinnedDurableUnitFile(
      serviceDescriptor,
      handle,
      spec.serviceUnitPath,
      serviceBytes,
      spec.serviceUnitSha256,
      spec,
    );
    injectCrash(crashInjector, 'after_durable_service_unit_observation');
    const initialTimer = observePinnedDurableUnitFile(
      timerDescriptor,
      handle,
      spec.timerUnitPath,
      timerBytes,
      spec.timerUnitSha256,
      spec,
    );
    injectCrash(crashInjector, 'after_durable_timer_unit_observation');
    const service = observePinnedDurableUnitFile(
      serviceDescriptor,
      handle,
      spec.serviceUnitPath,
      serviceBytes,
      spec.serviceUnitSha256,
      spec,
    );
    const timer = observePinnedDurableUnitFile(
      timerDescriptor,
      handle,
      spec.timerUnitPath,
      timerBytes,
      spec.timerUnitSha256,
      spec,
    );
    const dropIns = durableUnitDropInObservation(spec, handle);
    injectCrash(crashInjector, 'before_durable_unit_observation_commit');
    const finalService = observePinnedDurableUnitFile(
      serviceDescriptor,
      handle,
      spec.serviceUnitPath,
      serviceBytes,
      spec.serviceUnitSha256,
      spec,
    );
    const finalTimer = observePinnedDurableUnitFile(
      timerDescriptor,
      handle,
      spec.timerUnitPath,
      timerBytes,
      spec.timerUnitSha256,
      spec,
    );
    const finalDropIns = durableUnitDropInObservation(spec, handle);
    if (service === null
        || timer === null
        || finalService === null
        || finalTimer === null
        || canonicalJson(dropIns) !== canonicalJson(initialDropIns)
        || canonicalJson(finalDropIns) !== canonicalJson(dropIns)
        || canonicalJson(service) !== canonicalJson(initialService)
        || canonicalJson(timer) !== canonicalJson(initialTimer)
        || canonicalJson(finalService) !== canonicalJson(service)
        || canonicalJson(finalTimer) !== canonicalJson(timer)) {
      throw new Error('durable retention timer unit changed during exact observation');
    }
    const afterEvidence = durableUnitDirectoryEvidence(
      spec,
      handle.descriptor,
      fs.fstatSync(handle.descriptor, { bigint: true }),
    );
    if (!sameDurableUnitDirectoryIdentity(handle.evidence, afterEvidence)
        || service.device !== handle.evidence.device
        || timer.device !== handle.evidence.device) {
      throw new Error('durable retention timer unit directory or filesystem changed');
    }
    assertNamedDurableUnitDirectoryIdentity(spec, handle.evidence);
    const payload = durableUnitObservationPayload(
      spec,
      durableUnitAccessBinding(spec, handle.descriptor, handle.evidence),
      handle.evidence,
      finalDropIns,
      finalService,
      finalTimer,
    );
    const observation = {
      ...payload,
      observationDigest: sha256Text(canonicalJson(payload)),
    };
    const assertPinnedPublication = () => {
      const committedService = observePinnedDurableUnitFile(
        serviceDescriptor,
        handle,
        spec.serviceUnitPath,
        serviceBytes,
        spec.serviceUnitSha256,
        spec,
      );
      const committedTimer = observePinnedDurableUnitFile(
        timerDescriptor,
        handle,
        spec.timerUnitPath,
        timerBytes,
        spec.timerUnitSha256,
        spec,
      );
      const committedDirectory = durableUnitDirectoryEvidence(
        spec,
        handle.descriptor,
        fs.fstatSync(handle.descriptor, { bigint: true }),
      );
      const committedAccessBinding = durableUnitAccessBinding(
        spec,
        handle.descriptor,
        committedDirectory,
      );
      const committedDropIns = durableUnitDropInObservation(spec, handle);
      if (canonicalJson(committedService) !== canonicalJson(finalService)
          || canonicalJson(committedTimer) !== canonicalJson(finalTimer)
          || canonicalJson(committedDropIns) !== canonicalJson(finalDropIns)
          || canonicalJson(committedAccessBinding)
            !== canonicalJson(observation.accessBinding)
          || !sameDurableUnitDirectoryIdentity(
            handle.evidence,
            committedDirectory,
          )) {
        throw new Error(
          'durable retention timer unit publication changed across the pinned critical section',
        );
      }
      assertNamedDurableUnitDirectoryIdentity(spec, handle.evidence);
    };
    if (criticalSection !== null) {
      assertPinnedPublication();
      criticalSection(observation, assertPinnedPublication);
      injectCrash(
        crashInjector,
        'after_durable_unit_pinned_critical_section',
      );
      assertPinnedPublication();
      injectCrash(
        crashInjector,
        'before_durable_unit_commit_witness',
      );
      // Reopen and re-read both named units, every applicable drop-in path,
      // the directory identity, and the observed mount access once more after
      // the post-critical assertion.  This keeps a change at that assertion's
      // last descriptor-close boundary from being accepted as the committed
      // durable-unit state.
      assertPinnedPublication();
      fs.closeSync(timerDescriptor);
      timerDescriptor = null;
      fs.closeSync(serviceDescriptor);
      serviceDescriptor = null;
      injectCrash(
        crashInjector,
        'after_durable_unit_pinned_descriptor_release_before_return_witness',
      );
      // A successful pinned snapshot cannot authorize a later named state
      // merely because its descriptors stayed open.  Release both original
      // pins, reopen the service and timer no-follow through the pinned
      // directory, and repeat the complete byte/metadata/drop-in/mount
      // observation before this critical section may return.
      serviceDescriptor = openPinnedDurableUnitFile(
        handle,
        spec.serviceUnitPath,
      );
      timerDescriptor = openPinnedDurableUnitFile(
        handle,
        spec.timerUnitPath,
      );
      assertPinnedPublication();
      fs.closeSync(timerDescriptor);
      timerDescriptor = null;
      fs.closeSync(serviceDescriptor);
      serviceDescriptor = null;
      injectCrash(
        crashInjector,
        'after_durable_unit_return_witness_descriptor_release_before_confirmation',
      );
      // Confirm the named pair again after the first return witness has
      // released every unit-file descriptor. This rejects deletion,
      // replacement, and same-inode mutation triggered at that close boundary
      // before the authenticated observation can return to its caller.
      serviceDescriptor = openPinnedDurableUnitFile(
        handle,
        spec.serviceUnitPath,
      );
      timerDescriptor = openPinnedDurableUnitFile(
        handle,
        spec.timerUnitPath,
      );
      assertPinnedPublication();
      if (handoffSection !== null) {
        // Successor publication may have queried the manager while the first
        // unit pins were open, but those queries do not remain authoritative
        // across the descriptor-free return witness above. Consume the same
        // manager generation or firing once more while the final named pair is
        // pinned, then validate the pair again before releasing that handoff.
        injectCrash(
          crashInjector,
          'before_durable_unit_pinned_authority_handoff',
        );
        const accepted = handoffSection(
          observation,
          assertPinnedPublication,
        );
        if (accepted !== true) {
          throw new Error(
            'durable retention timer unit protected handoff did not consume its successor authority',
          );
        }
        protectedHandoffCompleted = true;
        injectCrash(
          crashInjector,
          'after_durable_unit_pinned_authority_handoff',
        );
        assertPinnedPublication();
      }
    }
    if (!protectedHandoffCompleted) {
      throw new Error(
        'durable retention timer unit successor left its protected handoff incomplete',
      );
    }
    return observation;
  } finally {
    if (timerDescriptor !== null) fs.closeSync(timerDescriptor);
    if (serviceDescriptor !== null) fs.closeSync(serviceDescriptor);
    fs.closeSync(handle.descriptor);
  }
}

function durableUnitFileObservationValid(
  observation,
  expectedPath,
  expectedBytes,
  expectedSha256,
  expectedOwner,
  requireMountIdentity,
) {
  const expectedKeys = [
    'path', 'device', 'inode', 'uid', 'gid', 'mode', 'nlink', 'bytes',
    'mtimeNs', 'ctimeNs', 'birthtimeNs', 'sha256',
  ];
  if (requireMountIdentity) expectedKeys.push('mountId');
  return exactObjectKeys(observation, expectedKeys)
    && observation.path === expectedPath
    && /^(0|[1-9][0-9]*)$/.test(String(observation.device || ''))
    && /^[1-9][0-9]*$/.test(String(observation.inode || ''))
    && (!requireMountIdentity
      || /^[1-9][0-9]*$/.test(String(observation.mountId || '')))
    && observation.uid === expectedOwner.uid
    && observation.gid === expectedOwner.gid
    && observation.mode === '0644'
    && observation.nlink === '1'
    && observation.bytes === expectedBytes
    && /^[0-9]+$/.test(String(observation.mtimeNs || ''))
    && /^[0-9]+$/.test(String(observation.ctimeNs || ''))
    && /^[0-9]+$/.test(String(observation.birthtimeNs || ''))
    && observation.sha256 === expectedSha256;
}

function durableUnitObservationValid(observation, spec) {
  const version9 = exactObjectKeys(observation, [
    'schemaVersion', 'timerSpecDigest', 'accessBinding', 'directory', 'dropIns',
    'service', 'timer', 'observationDigest',
  ])
    && observation.schemaVersion
      === 'cortex.learning_os.retention_durable_unit_observation.v9';
  const legacyVersion8 = exactObjectKeys(observation, [
    'schemaVersion', 'timerSpecDigest', 'accessBinding', 'directory', 'dropIns',
    'service', 'timer', 'observationDigest',
  ])
    && observation.schemaVersion
      === 'cortex.learning_os.retention_durable_unit_observation.v8';
  const legacyVersion7 = exactObjectKeys(observation, [
    'schemaVersion', 'timerSpecDigest', 'accessBinding', 'directory', 'dropIns',
    'service', 'timer', 'observationDigest',
  ])
    && observation.schemaVersion
      === 'cortex.learning_os.retention_durable_unit_observation.v7';
  const legacyVersion6 = exactObjectKeys(observation, [
    'schemaVersion', 'timerSpecDigest', 'accessBinding', 'directory', 'dropIns',
    'service', 'timer', 'observationDigest',
  ])
    && observation.schemaVersion
      === 'cortex.learning_os.retention_durable_unit_observation.v6';
  const legacyVersion5 = exactObjectKeys(observation, [
    'schemaVersion', 'timerSpecDigest', 'directory', 'dropIns', 'service',
    'timer', 'observationDigest',
  ])
    && observation.schemaVersion
      === 'cortex.learning_os.retention_durable_unit_observation.v5';
  const legacyVersion4 = exactObjectKeys(observation, [
    'schemaVersion', 'timerSpecDigest', 'directory', 'dropIns', 'service',
    'timer', 'observationDigest',
  ])
    && observation.schemaVersion
      === 'cortex.learning_os.retention_durable_unit_observation.v4';
  const legacyVersion3 = exactObjectKeys(observation, [
    'schemaVersion', 'timerSpecDigest', 'directory', 'service', 'timer',
    'observationDigest',
  ])
    && observation.schemaVersion
      === 'cortex.learning_os.retention_durable_unit_observation.v3';
  if ((!version9 && !legacyVersion8 && !legacyVersion7 && !legacyVersion6
      && !legacyVersion5 && !legacyVersion4 && !legacyVersion3)
      || observation.timerSpecDigest !== spec.specDigest
      || !exactObjectKeys(
        observation.directory,
        version9
          ? [
            'path', 'device', 'inode', 'mountId', 'uid', 'gid', 'mode',
            'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs',
          ]
          : (legacyVersion8 || legacyVersion7)
            ? [
              'path', 'device', 'inode', 'mountId', 'uid', 'gid', 'mode',
              'nlink',
            ]
            : ['path', 'device', 'inode', 'uid', 'gid', 'mode', 'nlink'],
      )) {
    return false;
  }
  const owner = durableUnitOwner(spec);
  const directoryMode = Number.parseInt(observation.directory.mode, 8);
  const directoryValid = observation.directory.path === spec.unitDirectory
    && /^(0|[1-9][0-9]*)$/.test(String(observation.directory.device || ''))
    && /^[1-9][0-9]*$/.test(String(observation.directory.inode || ''))
    && (!(version9 || legacyVersion8 || legacyVersion7)
      || /^[1-9][0-9]*$/.test(String(observation.directory.mountId || '')))
    && observation.directory.uid === owner.uid
    && observation.directory.gid === owner.gid
    && /^[0-7]{4}$/.test(String(observation.directory.mode || ''))
    && Number.isSafeInteger(directoryMode)
    && (directoryMode & 0o022) === 0
    && (spec.stateRootIdentity.production === true
      || observation.directory.mode === '0700')
    && /^[1-9][0-9]*$/.test(String(observation.directory.nlink || ''))
    && (!version9 || [
      'mtimeNs', 'ctimeNs', 'birthtimeNs',
    ].every((field) => (
      /^[0-9]+$/.test(String(observation.directory[field] || ''))
    )));
  const payload = version9
    ? durableUnitObservationPayload(
      spec,
      observation.accessBinding,
      observation.directory,
      observation.dropIns,
      observation.service,
      observation.timer,
    )
    : legacyVersion8
      ? legacyDurableUnitObservationV8Payload(
        spec,
        observation.accessBinding,
        observation.directory,
        observation.dropIns,
        observation.service,
        observation.timer,
      )
      : legacyVersion7
        ? legacyDurableUnitObservationV7Payload(
          spec,
          observation.accessBinding,
          observation.directory,
          observation.dropIns,
          observation.service,
          observation.timer,
        )
        : legacyVersion6
          ? legacyDurableUnitObservationV6Payload(
            spec,
            observation.accessBinding,
            observation.directory,
            observation.dropIns,
            observation.service,
            observation.timer,
          )
          : legacyVersion5
            ? legacyDurableUnitObservationV5Payload(
              spec,
              observation.directory,
              observation.dropIns,
              observation.service,
              observation.timer,
            )
            : legacyVersion4
              ? legacyDurableUnitObservationV4Payload(
                spec,
                observation.directory,
                observation.dropIns,
                observation.service,
                observation.timer,
              )
              : legacyDurableUnitObservationPayload(
                spec,
                observation.directory,
                observation.service,
                observation.timer,
              );
  return directoryValid
    && (version9 || legacyVersion8
      ? durableUnitAccessBindingValid(
        observation.accessBinding,
        spec,
        observation.directory,
      )
      : ((!legacyVersion7 && !legacyVersion6)
        || legacyDurableUnitAccessBindingValid(
          observation.accessBinding,
          spec,
        )))
    && (legacyVersion3
      || (legacyVersion4
        ? legacyDurableUnitDropInObservationValid(observation.dropIns, spec)
        : durableUnitDropInObservationValid(observation.dropIns, spec)))
    && observation.service.device === observation.directory.device
    && observation.timer.device === observation.directory.device
    && (!(version9 || legacyVersion8 || legacyVersion7)
      || (observation.service.mountId === observation.directory.mountId
        && observation.timer.mountId === observation.directory.mountId))
    && durableUnitFileObservationValid(
      observation.service,
      spec.serviceUnitPath,
      spec.serviceUnitBytes,
      spec.serviceUnitSha256,
      owner,
      version9 || legacyVersion8 || legacyVersion7,
    )
    && durableUnitFileObservationValid(
      observation.timer,
      spec.timerUnitPath,
      spec.timerUnitBytes,
      spec.timerUnitSha256,
      owner,
      version9 || legacyVersion8 || legacyVersion7,
    )
    && observation.observationDigest === sha256Text(canonicalJson(payload));
}

function mutateDurableTimerManager(systemctl, argv, commandRunner) {
  const result = commandRunner(systemctl, argv, {
    encoding: 'utf8',
    timeout: 10_000,
    env: { LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin', TZ: 'UTC' },
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `durable retention timer activation failed: ${
        result.error?.message || result.stderr || result.stdout || result.status
      }`,
    );
  }
}

function reloadDurableTimerManager(systemctl, commandRunner, crashInjector = null) {
  mutateDurableTimerManager(systemctl, ['daemon-reload'], commandRunner);
  injectCrash(crashInjector, 'after_daemon_reload');
}

function activateDurableTimer(systemctl, spec, commandRunner, crashInjector = null) {
  mutateDurableTimerManager(
    systemctl,
    ['enable', '--now', spec.timerUnit],
    commandRunner,
  );
  injectCrash(crashInjector, 'after_enable_now');
  return [systemctl, 'enable', '--now', spec.timerUnit];
}

function restartUnreleasedRetentionService(systemctl, spec, commandRunner) {
  mutateDurableTimerManager(
    systemctl,
    ['reset-failed', spec.serviceUnit],
    commandRunner,
  );
  mutateDurableTimerManager(
    systemctl,
    ['start', '--no-block', spec.serviceUnit],
    commandRunner,
  );
}

const TIMER_PHASES = Object.freeze([
  'pending',
  'created',
  'inspected',
  'install_pending',
  'installed',
]);
const MAX_TIMER_INSTALL_REPAIRS = 8;
const MAX_TIMER_TRANSITIONS = TIMER_PHASES.length
  + (MAX_TIMER_INSTALL_REPAIRS * 2)
  + 2;

function timerJournalPhaseSequenceValid(phases) {
  if (!Array.isArray(phases) || phases.length < 1) return false;
  if (phases.length <= TIMER_PHASES.length) {
    return canonicalJson(phases)
      === canonicalJson(TIMER_PHASES.slice(0, phases.length));
  }
  if (canonicalJson(phases.slice(0, TIMER_PHASES.length))
      !== canonicalJson(TIMER_PHASES)) {
    return false;
  }
  let index = TIMER_PHASES.length;
  let repairs = 0;
  let invalidationPending = false;
  while (['install_invalidated', 'install_repair'].includes(phases[index])) {
    if (phases[index] === 'install_invalidated') {
      if (invalidationPending) return false;
      invalidationPending = true;
    } else {
      repairs += 1;
      invalidationPending = false;
    }
    index += 1;
  }
  if (repairs > MAX_TIMER_INSTALL_REPAIRS) return false;
  if (!invalidationPending && phases[index] === 'fired') {
    index += 1;
    if (phases[index] === 'released') index += 1;
  }
  return index === phases.length;
}

function latestTimerInstallationTransition(journal) {
  return journal?.transitions?.filter((transition) => (
    ['installed', 'install_repair'].includes(transition.phase)
  )).at(-1) || null;
}

function installedDurableUnitObservation(journal) {
  const repaired = journal?.transitions?.filter((transition) => (
    transition.phase === 'install_repair'
    && isRecord(transition.evidence?.durableUnitObservation)
  )).at(-1)?.evidence?.durableUnitObservation;
  return repaired || journal?.transitions?.find((transition) => (
    transition.phase === 'inspected'
  ))?.evidence?.durableUnitObservation || null;
}

function exactObjectKeys(value, keys) {
  return isRecord(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function canonicalUtcTimestamp(value) {
  const milliseconds = Date.parse(String(value || ''));
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function operationNow(now) {
  const value = now ?? new Date().toISOString();
  if (!canonicalUtcTimestamp(value)) throw new Error('retention timer operation time is invalid');
  return value;
}

function injectCrash(crashInjector, phase) {
  if (crashInjector === undefined || crashInjector === null) return;
  if (typeof crashInjector !== 'function') throw new Error('retention crash injector is invalid');
  try {
    crashInjector(phase);
  } catch (error) {
    if (error !== null
        && (typeof error === 'object' || typeof error === 'function')) {
      try {
        Object.defineProperty(error, INJECTED_RETENTION_CRASH, {
          configurable: false,
          enumerable: false,
          value: true,
          writable: false,
        });
      } catch {}
    }
    throw error;
  }
}

function installedWaitBase(contract) {
  const payload = unsigned(contract);
  for (const field of [
    'sourceInstalledWaitDigest',
    'releaseDigest',
    'releaseFileSha256',
    'timerReleaseReceipt',
    'timerFiredAt',
    'timerReleasedAt',
  ]) delete payload[field];
  payload.timerReleased = false;
  return payload;
}

function buildTimerInstallationReceipt({
  spec,
  durableUnitObservationDigest,
  managerInspectionDigest,
  managerIdentityDigest,
  timerInvocationId,
  confirmedAt,
}) {
  const receipt = {
    schemaVersion: RETENTION_TIMER_INSTALLATION_RECEIPT_SCHEMA,
    timerSpecDigest: spec?.specDigest,
    durableUnitObservationDigest,
    managerInspectionDigest,
    managerIdentityDigest,
    timerInvocationId,
    confirmedAt,
  };
  if (!timerInstallationReceiptValid(receipt, spec, confirmedAt)) {
    throw new Error('retention timer installation receipt is invalid');
  }
  return receipt;
}

function timerInstallationReceiptValid(receipt, spec, installedAt) {
  const schemaVersion = receipt?.schemaVersion;
  const exposesManagerGeneration = schemaVersion
    === RETENTION_TIMER_INSTALLATION_RECEIPT_SCHEMA;
  return exactObjectKeys(receipt, [
    'schemaVersion', 'timerSpecDigest', 'durableUnitObservationDigest',
    'managerInspectionDigest', 'managerIdentityDigest', 'confirmedAt',
    ...(exposesManagerGeneration ? ['timerInvocationId'] : []),
  ])
    && [
      LEGACY_RETENTION_TIMER_INSTALLATION_RECEIPT_SCHEMA,
      OPAQUE_GENERATION_RETENTION_TIMER_INSTALLATION_RECEIPT_SCHEMA,
      RETENTION_TIMER_INSTALLATION_RECEIPT_SCHEMA,
    ].includes(schemaVersion)
    && receipt.timerSpecDigest === spec?.specDigest
    && DIGEST.test(String(receipt.durableUnitObservationDigest || ''))
    && DIGEST.test(String(receipt.managerInspectionDigest || ''))
    && DIGEST.test(String(receipt.managerIdentityDigest || ''))
    && (!exposesManagerGeneration
      || managerInvocationId(receipt.timerInvocationId))
    && canonicalUtcTimestamp(receipt.confirmedAt)
    && receipt.confirmedAt === installedAt;
}

function installationReceiptManagerIdentityIncludesGeneration(receipt) {
  return [
    OPAQUE_GENERATION_RETENTION_TIMER_INSTALLATION_RECEIPT_SCHEMA,
    RETENTION_TIMER_INSTALLATION_RECEIPT_SCHEMA,
  ].includes(receipt?.schemaVersion);
}

function installationReceiptExposesManagerGeneration(receipt) {
  return receipt?.schemaVersion === RETENTION_TIMER_INSTALLATION_RECEIPT_SCHEMA;
}

function managerInvocationId(value) {
  return /^[0-9a-f]{32}$/.test(String(value || ''));
}

function assertCurrentRetentionServiceInvocation(inspection, spec) {
  const observed = String(inspection?.service?.InvocationID || '');
  const mainPid = Number(inspection?.service?.MainPID);
  if (!managerInvocationId(observed)
      || !Number.isSafeInteger(mainPid)
      || mainPid < 1
      || String(mainPid) !== inspection?.service?.MainPID
      || inspection?.service?.ControlPID !== '0') {
    throw new Error(
      'retention timer manager did not expose the running service invocation identity',
    );
  }
  if (spec?.stateRootIdentity?.production === true) {
    const issued = String(process.env.INVOCATION_ID || '');
    if (!managerInvocationId(issued)
        || issued !== observed
        || mainPid !== process.pid) {
      throw new Error(
        'retention resume process is not the exact systemd-issued service main process',
      );
    }
  }
  return observed;
}

function managerFiringReceiptValid(
  receipt,
  spec,
  {
    inspection = null,
    requireExactServiceInvocation = true,
  } = {},
) {
  if (!exactObjectKeys(receipt, [
    'schemaVersion', 'manager', 'production', 'timerSpecDigest',
    'serviceUnit', 'serviceInvocationId', 'serviceMainPid',
    'timerUnit', 'timerInvocationId',
    'firedAt', 'managerInspectionDigest', 'managerIdentityDigest',
    'truthBoundary',
  ])
      || receipt.schemaVersion
        !== RETENTION_TIMER_MANAGER_FIRING_RECEIPT_SCHEMA
      || receipt.manager !== 'systemd'
      || receipt.production !== (spec?.stateRootIdentity?.production === true)
      || receipt.timerSpecDigest !== spec?.specDigest
      || receipt.serviceUnit !== spec?.serviceUnit
      || !managerInvocationId(receipt.serviceInvocationId)
      || !Number.isSafeInteger(receipt.serviceMainPid)
      || receipt.serviceMainPid < 1
      || receipt.timerUnit !== spec?.timerUnit
      || !managerInvocationId(receipt.timerInvocationId)
      || !canonicalUtcTimestamp(receipt.firedAt)
      || Date.parse(receipt.firedAt) < Date.parse(spec?.resumeAt || '')
      || !DIGEST.test(String(receipt.managerInspectionDigest || ''))
      || !DIGEST.test(String(receipt.managerIdentityDigest || ''))
      || receipt.truthBoundary
        !== 'This receipt records one exact systemd invocation generation and firing; it is not retention or qualification evidence.') {
    return false;
  }
  if (inspection === null) return true;
  const observedFiredAt = inspectedTimerFiredAt(
    inspection,
    spec,
    receipt.firedAt,
  );
  return inspection?.exact === true
    && observedFiredAt === receipt.firedAt
    && inspection.timer?.InvocationID === receipt.timerInvocationId
    && (!requireExactServiceInvocation
      || inspection.service?.InvocationID === receipt.serviceInvocationId)
    && (!requireExactServiceInvocation
      || Number(inspection.service?.MainPID) === receipt.serviceMainPid)
    && (!requireExactServiceInvocation
      || inspection.inspectionDigest === receipt.managerInspectionDigest)
    && retentionTimerManagerIdentityDigest({
      service: inspection.service,
      timer: inspection.timer,
    }, {
      includeInvocationGeneration: true,
    }) === receipt.managerIdentityDigest;
}

function buildManagerFiringReceipt({
  inspection,
  spec,
  firedAt,
}) {
  const serviceInvocationId = assertCurrentRetentionServiceInvocation(
    inspection,
    spec,
  );
  const receipt = {
    schemaVersion: RETENTION_TIMER_MANAGER_FIRING_RECEIPT_SCHEMA,
    manager: 'systemd',
    production: spec?.stateRootIdentity?.production === true,
    timerSpecDigest: spec?.specDigest,
    serviceUnit: spec?.serviceUnit,
    serviceInvocationId,
    serviceMainPid: Number(inspection?.service?.MainPID),
    timerUnit: spec?.timerUnit,
    timerInvocationId: String(inspection?.timer?.InvocationID || ''),
    firedAt,
    managerInspectionDigest: inspection?.inspectionDigest,
    managerIdentityDigest: retentionTimerManagerIdentityDigest({
      service: inspection?.service,
      timer: inspection?.timer,
    }, {
      includeInvocationGeneration: true,
    }),
    truthBoundary:
      'This receipt records one exact systemd invocation generation and firing; it is not retention or qualification evidence.',
  };
  if (!managerFiringReceiptValid(receipt, spec, { inspection })) {
    throw new Error('retention timer manager firing receipt is invalid');
  }
  return receipt;
}

function managerFiringGenerationMatchesInspection(
  receipt,
  inspection,
  spec,
) {
  return managerFiringReceiptValid(receipt, spec)
    && managerFiringReceiptValid(receipt, spec, {
      inspection,
      requireExactServiceInvocation: false,
    });
}

function buildTimerReleaseReceipt({
  spec,
  firedTransition,
  releasedJournal,
  releaseDigest,
  releaseFileSha256,
  releaseInspection,
  confirmedAt,
}) {
  const managerFiringReceipt =
    firedTransition?.evidence?.managerFiringReceipt;
  const releaseServiceInvocationId = assertCurrentRetentionServiceInvocation(
    releaseInspection,
    spec,
  );
  const receipt = {
    schemaVersion: RETENTION_TIMER_RELEASE_RECEIPT_SCHEMA,
    timerSpecDigest: spec?.specDigest,
    durableUnitObservationDigest:
      firedTransition?.evidence?.durableUnitObservationDigest,
    managerInspectionDigest: firedTransition?.evidence?.inspectionDigest,
    managerIdentityDigest: firedTransition?.evidence?.managerIdentityDigest,
    managerFiringReceiptDigest: digestRecord(managerFiringReceipt),
    firedAt: firedTransition?.evidence?.firedAt,
    releaseManagerInspectionDigest: releaseInspection?.inspectionDigest,
    releaseServiceInvocationId,
    releaseServiceMainPid: Number(releaseInspection?.service?.MainPID),
    releaseTimerInvocationId: releaseInspection?.timer?.InvocationID,
    releasedJournalDigest: digestRecord(releasedJournal),
    releaseDigest,
    releaseFileSha256,
    confirmedAt,
  };
  if (!timerReleaseReceiptValid(receipt, spec, {
    confirmedAt,
    firedTransition,
    releaseDigest,
    releaseFileSha256,
    releaseInspection,
    releasedJournal,
  })) {
    throw new Error('retention timer release receipt is invalid');
  }
  return receipt;
}

function timerReleaseReceiptValid(
  receipt,
  spec,
  {
    confirmedAt,
    firedTransition = null,
    releaseDigest = null,
    releaseFileSha256 = null,
    releaseInspection = null,
    releasedJournal = null,
  } = {},
) {
  if (!exactObjectKeys(receipt, [
    'schemaVersion', 'timerSpecDigest', 'durableUnitObservationDigest',
    'managerInspectionDigest', 'managerIdentityDigest',
    'managerFiringReceiptDigest', 'firedAt',
    'releaseManagerInspectionDigest', 'releaseServiceInvocationId',
    'releaseServiceMainPid', 'releaseTimerInvocationId',
    'releasedJournalDigest', 'releaseDigest', 'releaseFileSha256',
    'confirmedAt',
  ])
      || receipt.schemaVersion !== RETENTION_TIMER_RELEASE_RECEIPT_SCHEMA
      || receipt.timerSpecDigest !== spec?.specDigest
      || !DIGEST.test(String(receipt.durableUnitObservationDigest || ''))
      || !DIGEST.test(String(receipt.managerInspectionDigest || ''))
      || !DIGEST.test(String(receipt.managerIdentityDigest || ''))
      || !DIGEST.test(String(receipt.managerFiringReceiptDigest || ''))
      || !canonicalUtcTimestamp(receipt.firedAt)
      || Date.parse(receipt.firedAt) < Date.parse(spec?.resumeAt || '')
      || !DIGEST.test(String(receipt.releaseManagerInspectionDigest || ''))
      || !managerInvocationId(receipt.releaseServiceInvocationId)
      || !Number.isSafeInteger(receipt.releaseServiceMainPid)
      || receipt.releaseServiceMainPid < 1
      || !managerInvocationId(receipt.releaseTimerInvocationId)
      || !DIGEST.test(String(receipt.releasedJournalDigest || ''))
      || !DIGEST.test(String(receipt.releaseDigest || ''))
      || !DIGEST.test(String(receipt.releaseFileSha256 || ''))
      || !canonicalUtcTimestamp(receipt.confirmedAt)) {
    return false;
  }
  if (confirmedAt !== undefined && receipt.confirmedAt !== confirmedAt) return false;
  if (releaseDigest !== null && receipt.releaseDigest !== releaseDigest) return false;
  if (releaseFileSha256 !== null
      && receipt.releaseFileSha256 !== releaseFileSha256) return false;
  if (releaseInspection !== null
      && (receipt.releaseManagerInspectionDigest
          !== releaseInspection.inspectionDigest
        || receipt.releaseServiceInvocationId
          !== releaseInspection.service?.InvocationID
        || receipt.releaseServiceMainPid
          !== Number(releaseInspection.service?.MainPID)
        || receipt.releaseTimerInvocationId
          !== releaseInspection.timer?.InvocationID
        || firedTransition === null
        || !managerFiringGenerationMatchesInspection(
          firedTransition.evidence?.managerFiringReceipt,
          releaseInspection,
          spec,
        ))) {
    return false;
  }
  if (releasedJournal !== null
      && receipt.releasedJournalDigest !== digestRecord(releasedJournal)) return false;
  return firedTransition === null || (
    receipt.durableUnitObservationDigest
      === firedTransition?.evidence?.durableUnitObservationDigest
    && receipt.managerInspectionDigest
      === firedTransition?.evidence?.inspectionDigest
    && receipt.managerIdentityDigest
      === firedTransition?.evidence?.managerIdentityDigest
    && receipt.managerFiringReceiptDigest
      === digestRecord(firedTransition?.evidence?.managerFiringReceipt)
    && receipt.releaseTimerInvocationId
      === firedTransition?.evidence?.managerFiringReceipt?.timerInvocationId
    && receipt.firedAt === firedTransition?.evidence?.firedAt
  );
}

function retentionTimerManagerIdentityDigest(
  inspection,
  { includeInvocationGeneration = false } = {},
) {
  if (!exactObjectKeys(inspection, ['service', 'timer'])) {
    throw new Error('retention timer manager identity requires one exact inspection');
  }
  const service = structuredClone(inspection.service);
  const timer = structuredClone(inspection.timer);
  // The oneshot service is configured to restart after a failed resume
  // process, so its InvocationID and process PIDs are deliberately not durable
  // firing identity. Each successor receipt binds its own exact service
  // invocation and MainPID separately.
  // The timer InvocationID, by contrast, identifies the manager activation
  // that issued LastTriggerUSec and must remain stable across release commits.
  delete service.InvocationID;
  delete service.MainPID;
  delete service.ControlPID;
  if (!includeInvocationGeneration) {
    delete timer.InvocationID;
  }
  for (const field of [
    'ActiveState', 'SubState', 'ExecStart', 'ExecStartEx', 'ExecStartExDbus',
  ]) delete service[field];
  const calendarExpressions = exactSystemdCalendarExpressions(timer.TimersCalendar);
  for (const field of [
    'ActiveState', 'SubState', 'LastTriggerUSec', 'NextElapseUSecRealtime',
    'TimersCalendar',
  ]) delete timer[field];
  return sha256Text(canonicalJson({
    service,
    timer,
    calendarExpressions,
  }));
}

function journalPayload({
  sourceWait,
  spec,
  phase,
  transitions,
  schemaVersion = RETENTION_TIMER_JOURNAL_SCHEMA,
}) {
  return {
    schemaVersion,
    journalId: spec.specDigest,
    subjectId: sourceWait.subjectId,
    waitPath: sourceWait.waitPath,
    sourceWaitDigest: digestRecord(sourceWait),
    timerSpec: structuredClone(spec),
    phase,
    transitions,
    truthBoundary: 'This authenticated journal records timer publication and one exact due release; no transition is retention evidence.',
  };
}

function transitionEvidenceValid(transition, journal) {
  const evidence = transition.evidence;
  const spec = journal.timerSpec;
  if (transition.phase === 'pending') {
    return exactObjectKeys(evidence, ['sourceWaitDigest', 'timerSpecDigest'])
      && evidence.sourceWaitDigest === journal.sourceWaitDigest
      && evidence.timerSpecDigest === spec.specDigest;
  }
  if (transition.phase === 'created') {
    return exactObjectKeys(evidence, [
      'adopted', 'timerServiceUnit', 'timerSpecDigest', 'timerUnit',
    ])
      && typeof evidence.adopted === 'boolean'
      && evidence.timerServiceUnit === spec.serviceUnit
      && evidence.timerUnit === spec.timerUnit
      && evidence.timerSpecDigest === spec.specDigest;
  }
  if (transition.phase === 'inspected') {
    return exactObjectKeys(evidence, [
      'durableUnitObservation', 'durableUnitObservationDigest', 'inspection',
      'inspectionDigest', 'timerServiceUnit', 'timerSpecDigest', 'timerUnit',
    ])
      && durableUnitObservationValid(evidence.durableUnitObservation, spec)
      && evidence.durableUnitObservationDigest
        === evidence.durableUnitObservation.observationDigest
      && retentionTimerInspectionEvidenceValid(evidence, spec, {
        allowFired: Date.parse(transition.recordedAt) >= Date.parse(spec.resumeAt),
      })
      && evidence.timerServiceUnit === spec.serviceUnit
      && evidence.timerUnit === spec.timerUnit
      && evidence.timerSpecDigest === spec.specDigest;
  }
  if (transition.phase === 'install_pending') {
    return exactObjectKeys(evidence, [
      'durableUnitObservation', 'durableUnitObservationDigest', 'inspection',
      'inspectionDigest', 'timerServiceUnit', 'timerSpecDigest', 'timerUnit',
    ])
      && durableUnitObservationValid(evidence.durableUnitObservation, spec)
      && evidence.durableUnitObservationDigest
        === evidence.durableUnitObservation.observationDigest
      && retentionTimerInspectionEvidenceValid(evidence, spec, {
        allowFired: Date.parse(transition.recordedAt) >= Date.parse(spec.resumeAt),
      })
      && evidence.timerServiceUnit === spec.serviceUnit
      && evidence.timerUnit === spec.timerUnit
      && evidence.timerSpecDigest === spec.specDigest;
  }
  if (transition.phase === 'installed') {
    return exactObjectKeys(evidence, [
      'durableUnitObservationDigest', 'installedWaitDigest',
      'installationReceipt', 'pendingInspectionDigest',
      'pendingJournalDigest', 'inspection',
      'inspectionDigest',
    ])
      && DIGEST.test(String(evidence.durableUnitObservationDigest || ''))
      && evidence.durableUnitObservationDigest === journal.transitions.find(
        (row) => row.phase === 'install_pending',
      )?.evidence?.durableUnitObservationDigest
      && DIGEST.test(String(evidence.installedWaitDigest || ''))
      && DIGEST.test(String(evidence.pendingInspectionDigest || ''))
      && evidence.pendingInspectionDigest === journal.transitions.find(
        (row) => row.phase === 'install_pending',
      )?.evidence?.inspectionDigest
      && retentionTimerInspectionEvidenceValid(evidence, spec, {
        allowFired: Date.parse(transition.recordedAt) >= Date.parse(spec.resumeAt),
      })
      && timerInstallationReceiptValid(
        evidence.installationReceipt,
        spec,
        transition.recordedAt,
      )
      && evidence.installationReceipt.durableUnitObservationDigest
        === evidence.durableUnitObservationDigest
      && evidence.installationReceipt.managerInspectionDigest
        === evidence.inspectionDigest
      && evidence.installationReceipt.managerIdentityDigest
        === retentionTimerManagerIdentityDigest(evidence.inspection, {
          includeInvocationGeneration:
            installationReceiptManagerIdentityIncludesGeneration(
              evidence.installationReceipt,
            ),
        })
      && (!installationReceiptExposesManagerGeneration(
        evidence.installationReceipt,
      ) || evidence.installationReceipt.timerInvocationId
        === evidence.inspection?.timer?.InvocationID)
      && DIGEST.test(String(evidence.pendingJournalDigest || ''))
      && evidence.pendingJournalDigest === transition.previousJournalDigest;
  }
  if (transition.phase === 'install_invalidated') {
    const previousInstallation = journal.transitions
      .slice(0, transition.index)
      .filter((candidate) => (
        ['installed', 'install_repair'].includes(candidate.phase)
      ))
      .at(-1);
    return exactObjectKeys(evidence, [
      'durableUnitObservationDigest', 'installedWaitDigest',
      'installationReceiptDigest', 'reason',
    ])
      && DIGEST.test(String(evidence.durableUnitObservationDigest || ''))
      && evidence.durableUnitObservationDigest
        === previousInstallation?.evidence?.durableUnitObservationDigest
      && DIGEST.test(String(evidence.installedWaitDigest || ''))
      && evidence.installedWaitDigest
        === previousInstallation?.evidence?.installedWaitDigest
      && DIGEST.test(String(evidence.installationReceiptDigest || ''))
      && evidence.installationReceiptDigest
        === digestRecord(previousInstallation?.evidence?.installationReceipt)
      && [
        'pre_promotion_authority_revalidation_failed',
        'post_promotion_authority_revalidation_failed',
        'promotion_outcome_unobservable',
      ].includes(evidence.reason);
  }
  if (transition.phase === 'install_repair') {
    const previousInstallation = journal.transitions
      .slice(0, transition.index)
      .filter((candidate) => (
        ['installed', 'install_repair'].includes(candidate.phase)
      ))
      .at(-1);
    const legacyKeys = [
      'durableUnitObservationDigest', 'installedWaitDigest',
      'installationReceipt', 'inspection', 'inspectionDigest',
      'supersededInstallationReceiptDigest',
    ];
    const repairsDurableUnits = Object.hasOwn(
      evidence,
      'durableUnitObservation',
    );
    const repairsPublishedWait = Object.hasOwn(
      evidence,
      'supersededInstalledWaitDigest',
    );
    const previousInvalidation = journal.transitions
      .slice((previousInstallation?.index ?? -1) + 1, transition.index)
      .filter((candidate) => candidate.phase === 'install_invalidated')
      .at(-1);
    const previousRepairWasNotObservable = previousInstallation?.phase
        === 'install_repair'
      && previousInvalidation?.evidence?.installedWaitDigest
        === previousInstallation.evidence.installedWaitDigest
      && [
        'pre_promotion_authority_revalidation_failed',
        'promotion_outcome_unobservable',
      ].includes(previousInvalidation?.evidence?.reason);
    const expectedPublishedPredecessorDigest = previousRepairWasNotObservable
      ? previousInstallation.evidence.supersededInstalledWaitDigest
      : previousInstallation?.evidence?.installedWaitDigest;
    return exactObjectKeys(
      evidence,
      [
        ...legacyKeys,
        ...(repairsDurableUnits ? ['durableUnitObservation'] : []),
        ...(repairsPublishedWait ? ['supersededInstalledWaitDigest'] : []),
      ],
    )
      && DIGEST.test(String(evidence.durableUnitObservationDigest || ''))
      && (repairsDurableUnits
        ? (durableUnitObservationValid(evidence.durableUnitObservation, spec)
          && evidence.durableUnitObservationDigest
            === evidence.durableUnitObservation.observationDigest)
        : evidence.durableUnitObservationDigest === journal.transitions.find(
          (row) => row.phase === 'install_pending',
        )?.evidence?.durableUnitObservationDigest)
      && DIGEST.test(String(evidence.installedWaitDigest || ''))
      && retentionTimerInspectionEvidenceValid(evidence, spec, {
        allowFired: Date.parse(transition.recordedAt) >= Date.parse(spec.resumeAt),
      })
      && timerInstallationReceiptValid(
        evidence.installationReceipt,
        spec,
        transition.recordedAt,
      )
      && evidence.installationReceipt.durableUnitObservationDigest
        === evidence.durableUnitObservationDigest
      && evidence.installationReceipt.managerInspectionDigest
        === evidence.inspectionDigest
      && evidence.installationReceipt.managerIdentityDigest
        === retentionTimerManagerIdentityDigest(evidence.inspection, {
          includeInvocationGeneration:
            installationReceiptManagerIdentityIncludesGeneration(
              evidence.installationReceipt,
            ),
        })
      && (!installationReceiptExposesManagerGeneration(
        evidence.installationReceipt,
      ) || evidence.installationReceipt.timerInvocationId
        === evidence.inspection?.timer?.InvocationID)
      && DIGEST.test(String(
        evidence.supersededInstallationReceiptDigest || '',
      ))
      && previousInstallation !== undefined
      && evidence.supersededInstallationReceiptDigest
        === digestRecord(previousInstallation?.evidence?.installationReceipt)
      && (!repairsPublishedWait
        || (DIGEST.test(String(evidence.supersededInstalledWaitDigest || ''))
          && evidence.supersededInstalledWaitDigest
            === expectedPublishedPredecessorDigest));
  }
  if (transition.phase === 'fired') {
    return exactObjectKeys(evidence, [
      'durableUnitObservation', 'durableUnitObservationDigest', 'firedAt',
      'firingSpecDigest', 'inspectedDurableUnitObservationDigest', 'inspection',
      'inspectionDigest', 'managerFiringReceipt', 'managerIdentityDigest',
    ])
      && canonicalUtcTimestamp(evidence.firedAt)
      && Date.parse(evidence.firedAt) >= Date.parse(spec.resumeAt)
      && Date.parse(evidence.firedAt) <= Date.parse(transition.recordedAt)
      && evidence.firingSpecDigest === spec.specDigest
      && evidence.durableUnitObservation?.schemaVersion
        === 'cortex.learning_os.retention_durable_unit_observation.v9'
      && durableUnitObservationValid(evidence.durableUnitObservation, spec)
      && durableUnitFiredAccessValid(evidence.durableUnitObservation, spec)
      && evidence.durableUnitObservationDigest
        === evidence.durableUnitObservation.observationDigest
      && evidence.inspectedDurableUnitObservationDigest
        === installedDurableUnitObservation(journal)?.observationDigest
      && sameDurableUnitPublicationIdentity(
        evidence.durableUnitObservation,
        installedDurableUnitObservation(journal),
      )
      && retentionTimerInspectionEvidenceValid(evidence, spec, {
        allowFired: true,
      })
      && evidence.managerIdentityDigest
        === retentionTimerManagerIdentityDigest(evidence.inspection, {
          includeInvocationGeneration: true,
        })
      && managerFiringReceiptValid(
        evidence.managerFiringReceipt,
        spec,
        {
          inspection: {
            exact: true,
            inspectionDigest: evidence.inspectionDigest,
            service: evidence.inspection.service,
            timer: evidence.inspection.timer,
          },
        },
      )
      && evidence.managerFiringReceipt.firedAt === evidence.firedAt
      && evidence.managerFiringReceipt.managerInspectionDigest
        === evidence.inspectionDigest
      && evidence.managerFiringReceipt.managerIdentityDigest
        === evidence.managerIdentityDigest
      && evidence.inspection.timer.SubState !== 'waiting'
      && Number.isFinite(Date.parse(String(
        evidence.inspection.timer.LastTriggerUSec || '',
      )))
      && new Date(Date.parse(
        evidence.inspection.timer.LastTriggerUSec,
      )).toISOString() === evidence.firedAt;
  }
  if (transition.phase === 'released') {
    return exactObjectKeys(evidence, [
      'managerFiringReceiptDigest', 'releaseDigest', 'releaseFileSha256',
      'releasePath', 'releasedAt',
    ])
      && evidence.managerFiringReceiptDigest === digestRecord(
        journal.transitions.find(
          (row) => row.phase === 'fired',
        )?.evidence?.managerFiringReceipt,
      )
      && evidence.releasePath === spec.releasePath
      && DIGEST.test(String(evidence.releaseDigest || ''))
      && DIGEST.test(String(evidence.releaseFileSha256 || ''))
      && canonicalUtcTimestamp(evidence.releasedAt)
      && evidence.releasedAt === journal.transitions.find(
        (row) => row.phase === 'fired',
      )?.evidence?.firedAt;
  }
  return false;
}

export function verifyRetentionTimerJournal({
  journal,
  contract,
  signingSecret,
} = {}) {
  if (!verifyRetentionWaitContract(contract, signingSecret)
      || contract.persisted !== true
      || !exactObjectKeys(journal, [
        'schemaVersion', 'journalId', 'subjectId', 'waitPath', 'sourceWaitDigest',
        'timerSpec', 'phase', 'transitions', 'truthBoundary',
        'controlPlaneSignature',
      ])
      || ![
        LEGACY_RETENTION_TIMER_JOURNAL_SCHEMA,
        RETENTION_TIMER_JOURNAL_SCHEMA,
      ].includes(journal.schemaVersion)
      || !validSignatureEnvelope(journal.controlPlaneSignature)
      || !verifySignature(journal, signingSecret)
      || journal.subjectId !== contract.subjectId
      || journal.waitPath !== contract.waitPath
      || typeof journal.truthBoundary !== 'string'
      || !Array.isArray(journal.transitions)
      || journal.transitions.length < 1
      || journal.transitions.length > MAX_TIMER_TRANSITIONS) {
    return false;
  }
  const sourceWait = sign(waitBase(contract), signingSecret);
  const expectedSpec = buildRetentionTimerSpec(sourceWait);
  if (journal.sourceWaitDigest !== digestRecord(sourceWait)
      || journal.journalId !== expectedSpec.specDigest
      || canonicalJson(journal.timerSpec) !== canonicalJson(expectedSpec)) {
    return false;
  }
  const phases = journal.transitions.map((transition) => transition?.phase);
  if (journal.schemaVersion === LEGACY_RETENTION_TIMER_JOURNAL_SCHEMA
      && phases.some((phase) => ['fired', 'released'].includes(phase))) {
    return false;
  }
  if (!timerJournalPhaseSequenceValid(phases)
      || journal.phase !== phases.at(-1)) {
    return false;
  }
  if (journal.phase === 'install_invalidated') {
    const invalidationReason = journal.transitions.at(-1)?.evidence?.reason;
    const installation = latestTimerInstallationTransition(journal);
    const supersededRepairStillPublished = installation?.phase === 'install_repair'
      && installation.evidence?.supersededInstalledWaitDigest
        === digestRecord(contract);
    const expectedReason = contract.timerInstalled === true
        && !supersededRepairStillPublished
      ? 'post_promotion_authority_revalidation_failed'
      : 'pre_promotion_authority_revalidation_failed';
    if (invalidationReason !== expectedReason
        && invalidationReason !== 'promotion_outcome_unobservable') {
      return false;
    }
  }
  let previousRecordedAt = null;
  for (let index = 0; index < journal.transitions.length; index += 1) {
    const transition = journal.transitions[index];
    if (!exactObjectKeys(transition, [
      'index', 'phase', 'recordedAt', 'previousJournalDigest', 'evidence',
    ])
        || transition.index !== index
        || !canonicalUtcTimestamp(transition.recordedAt)
        || (previousRecordedAt !== null
          && Date.parse(transition.recordedAt) < Date.parse(previousRecordedAt))
        || !transitionEvidenceValid(transition, journal)) {
      return false;
    }
    if (index === 0) {
      if (transition.previousJournalDigest !== null) return false;
    } else {
      const previousTransitions = journal.transitions.slice(0, index);
      const previous = sign(journalPayload({
        sourceWait,
        spec: expectedSpec,
        phase: previousTransitions.at(-1).phase,
        transitions: previousTransitions,
        schemaVersion: journal.schemaVersion,
      }), signingSecret);
      if (transition.previousJournalDigest !== digestRecord(previous)) {
        return false;
      }
    }
    previousRecordedAt = transition.recordedAt;
  }
  if (contract.timerInstalled === true) {
    const installedWait = contract.timerReleased === true
      ? sign(installedWaitBase(contract), signingSecret)
      : contract;
    const pending = journal.transitions.find(
      (transition) => transition.phase === 'install_pending',
    );
    const installed = latestTimerInstallationTransition(journal);
    const installedUnitObservation = installedDurableUnitObservation(journal);
    // Count only the repair transitions on the wait's actual published
    // predecessor chain. A confirmed repair can be invalidated before its CAS
    // becomes observable and followed by another repair of the same durable
    // predecessor; counting every journal repair would fabricate a wait
    // revision that was never published.
    let publishedInstallationRepairs = 0;
    let publishedPredecessorDigest = digestRecord(installedWait);
    let publishedInstallationChainRooted = false;
    for (const transition of [...journal.transitions].reverse()) {
      if (!['installed', 'install_repair'].includes(transition.phase)
          || transition.evidence?.installedWaitDigest
            !== publishedPredecessorDigest) {
        continue;
      }
      if (transition.phase === 'installed') {
        publishedInstallationChainRooted = true;
        break;
      }
      if (!Object.hasOwn(
        transition.evidence || {},
        'supersededInstalledWaitDigest',
      )) {
        // This repair promotes an installation that never had a published
        // installed predecessor; it is the root of the durable wait chain,
        // not a revision of one.
        publishedInstallationChainRooted = true;
        break;
      }
      publishedInstallationRepairs += 1;
      publishedPredecessorDigest =
        transition.evidence.supersededInstalledWaitDigest;
    }
    if (canonicalJson(installed?.evidence?.installationReceipt)
          !== canonicalJson(contract.timerInstallationReceipt)
        || installed?.evidence?.installedWaitDigest !== digestRecord(installedWait)
        || installed?.evidence?.durableUnitObservationDigest
          !== contract.timerInstallationReceipt.durableUnitObservationDigest
        || installed?.evidence?.inspectionDigest
          !== contract.timerInstallationReceipt.managerInspectionDigest
        || installedUnitObservation?.observationDigest
          !== contract.timerInstallationReceipt.durableUnitObservationDigest
        || !publishedInstallationChainRooted
        || (installed?.phase === 'installed'
          && pending?.evidence?.durableUnitObservationDigest
            !== contract.timerInstallationReceipt.durableUnitObservationDigest)
        || (Object.hasOwn(installed?.evidence || {}, 'supersededInstalledWaitDigest')
          ? (contract.supersededInstalledWaitDigest
              !== installed.evidence.supersededInstalledWaitDigest
            || !Number.isSafeInteger(contract.timerInstallationRevision)
            || contract.timerInstallationRevision
              !== publishedInstallationRepairs)
          : (Object.hasOwn(contract, 'supersededInstalledWaitDigest')
            || Object.hasOwn(contract, 'timerInstallationRevision')))) {
      return false;
    }
  }
  if (contract.timerReleased === true) {
    const fired = journal.transitions.find(
      (transition) => transition.phase === 'fired',
    );
    const released = journal.transitions.at(-1);
    if (journal.phase !== 'released'
        || fired?.evidence?.firedAt !== contract.timerFiredAt
        || released?.evidence?.releaseDigest !== contract.releaseDigest
        || released?.evidence?.releaseFileSha256 !== contract.releaseFileSha256
        || released?.evidence?.releasedAt !== contract.timerFiredAt
        || !timerReleaseReceiptValid(contract.timerReleaseReceipt, expectedSpec, {
          confirmedAt: contract.timerReleasedAt,
          firedTransition: fired,
          releaseDigest: contract.releaseDigest,
          releaseFileSha256: contract.releaseFileSha256,
          releasedJournal: journal,
        })) {
      return false;
    }
  }
  return true;
}

function initialTimerJournal({ sourceWait, spec, recordedAt, signingSecret }) {
  const transition = {
    index: 0,
    phase: 'pending',
    recordedAt,
    previousJournalDigest: null,
    evidence: {
      sourceWaitDigest: digestRecord(sourceWait),
      timerSpecDigest: spec.specDigest,
    },
  };
  return sign(journalPayload({
    sourceWait,
    spec,
    phase: 'pending',
    transitions: [transition],
  }), signingSecret);
}

function advanceTimerJournal({
  journal,
  sourceWait,
  spec,
  phase,
  evidence,
  recordedAt,
  signingSecret,
}) {
  const currentPhase = journal.transitions.at(-1)?.phase;
  const expectedPhase = journal.transitions.length < TIMER_PHASES.length
    ? TIMER_PHASES[journal.transitions.length]
    : null;
  const allowed = expectedPhase === null
    ? ((['installed', 'install_repair'].includes(currentPhase)
      && ['install_invalidated', 'install_repair', 'fired'].includes(phase))
      || (currentPhase === 'install_invalidated' && phase === 'install_repair')
      || (currentPhase === 'fired' && phase === 'released'))
    : phase === expectedPhase;
  if (!allowed
      || (phase === 'install_repair'
        && journal.transitions.filter((transition) => (
          transition.phase === 'install_repair'
        )).length >= MAX_TIMER_INSTALL_REPAIRS)) {
    throw new Error(`retention timer journal transition is out of order: ${phase}`);
  }
  if (!canonicalUtcTimestamp(recordedAt)
      || Date.parse(recordedAt) < Date.parse(journal.transitions.at(-1).recordedAt)) {
    throw new Error('retention timer journal transition time moved backwards');
  }
  const transition = {
    index: journal.transitions.length,
    phase,
    recordedAt,
    previousJournalDigest: digestRecord(journal),
    evidence,
  };
  return sign(journalPayload({
    sourceWait,
    spec,
    phase,
    transitions: [...journal.transitions, transition],
  }), signingSecret);
}

function writeTimerJournal(journalPath, journal, predecessor = null) {
  atomicOwnerOnlyJson(
    journalPath,
    journal,
    journal.timerSpec.stateRootIdentity,
    { expectedDigest: predecessor === null ? null : digestRecord(predecessor) },
  );
}

function validateTimerJournalRecord(journal, contract, signingSecret) {
  if (!isRecord(journal)) {
    throw new Error('retention timer journal is stale, tampered, or inconsistent');
  }
  const invalidationReason = journal.phase === 'install_invalidated'
    ? journal.transitions.at(-1)?.evidence?.reason
    : null;
  const invalidatedInstallation = latestTimerInstallationTransition(journal);
  const publishedWaitDigest = digestRecord(contract);
  const prePromotionInvalidationMatchesWait = contract.timerInstalled === false
    || (invalidatedInstallation?.phase === 'install_repair'
      && invalidatedInstallation.evidence?.supersededInstalledWaitDigest
        === publishedWaitDigest);
  const postPromotionInvalidationMatchesWait = contract.timerInstalled === true
    && invalidatedInstallation?.evidence?.installedWaitDigest
      === publishedWaitDigest;
  const invalidationContradictsWait = journal.phase === 'install_invalidated'
    && ((invalidationReason === 'pre_promotion_authority_revalidation_failed'
      && !prePromotionInvalidationMatchesWait)
    || (invalidationReason === 'post_promotion_authority_revalidation_failed'
      && !postPromotionInvalidationMatchesWait));
  const rolledBack = (contract.timerInstalled === false
      && ['fired', 'released'].includes(journal.phase))
    || invalidationContradictsWait
    || (contract.timerInstalled === true
      && ['pending', 'created', 'inspected', 'install_pending'].includes(journal.phase))
    || (contract.timerReleased === true && journal.phase !== 'released');
  if (rolledBack) {
    const prefixContract = ['pending', 'created', 'inspected', 'install_pending']
      .includes(journal.phase)
      ? sign(waitBase(contract), signingSecret)
      : (contract.timerReleased === true
        ? sign(installedWaitBase(contract), signingSecret)
        : contract);
    if (verifyRetentionTimerJournal({
      journal,
      contract: prefixContract,
      signingSecret,
    })) {
      throw new Error(
        'retention timer journal was rolled back across an authenticated publication',
      );
    }
  }
  let journalContract = contract;
  let verified = verifyRetentionTimerJournal({
    journal,
    contract: journalContract,
    signingSecret,
  });
  const pendingRepair = latestTimerInstallationTransition(journal);
  const journalHasUnpromotedRepair = journal.phase === 'install_repair'
    || (journal.phase === 'install_invalidated'
      && [
        'pre_promotion_authority_revalidation_failed',
        'promotion_outcome_unobservable',
      ].includes(invalidationReason));
  if (!verified
      && contract.timerInstalled === true
      && contract.timerReleased === false
      && journalHasUnpromotedRepair
      && pendingRepair?.phase === 'install_repair'
      && pendingRepair?.evidence?.supersededInstalledWaitDigest
        === digestRecord(contract)) {
    const sourceWait = sign(waitBase(contract), signingSecret);
    journalContract = buildInstalledWait({
      persisted: contract,
      sourceWait,
      spec: journal.timerSpec,
      installedAt: pendingRepair.recordedAt,
      installationReceipt: pendingRepair.evidence.installationReceipt,
      signingSecret,
    });
    verified = verifyRetentionTimerJournal({
      journal,
      contract: journalContract,
      signingSecret,
    });
  }
  if (!verified) {
    throw new Error('retention timer journal is stale, tampered, or inconsistent');
  }
  if (rolledBack) {
    throw new Error('retention timer journal was rolled back across an authenticated publication');
  }
  return journal;
}

function readTimerJournal(
  journalPath,
  contract,
  signingSecret,
  { consume = null } = {},
) {
  if (consume !== null && typeof consume !== 'function') {
    throw new Error('retention timer journal protected consumer is invalid');
  }
  if (!protectedStateFileExists(journalPath, contract.stateRootIdentity)) return null;
  if (consume === null) {
    return validateTimerJournalRecord(
      readOwnerOnlyJson(journalPath, contract.stateRootIdentity),
      contract,
      signingSecret,
    );
  }
  return readOwnerOnlyJson(
    journalPath,
    contract.stateRootIdentity,
    {
      consume(candidate) {
        return consume(validateTimerJournalRecord(
          candidate,
          contract,
          signingSecret,
        ));
      },
    },
  );
}

function migrateLegacyTimerJournal({
  journal,
  contract,
  sourceWait,
  spec,
  signingSecret,
  crashInjector = null,
}) {
  if (journal?.schemaVersion === RETENTION_TIMER_JOURNAL_SCHEMA) {
    return journal;
  }
  if (journal?.schemaVersion !== LEGACY_RETENTION_TIMER_JOURNAL_SCHEMA
      || journal.transitions.some((transition) => (
        ['fired', 'released'].includes(transition.phase)
      ))) {
    throw new Error(
      'legacy retention timer journal cannot cross the manager-firing receipt boundary',
    );
  }
  const transitions = [];
  for (const sourceTransition of journal.transitions) {
    const transition = structuredClone(sourceTransition);
    if (transitions.length === 0) {
      transition.previousJournalDigest = null;
    } else {
      const predecessor = sign(journalPayload({
        sourceWait,
        spec,
        phase: transitions.at(-1).phase,
        transitions,
      }), signingSecret);
      transition.previousJournalDigest = digestRecord(predecessor);
      if (transition.phase === 'installed') {
        transition.evidence.pendingJournalDigest =
          transition.previousJournalDigest;
      }
    }
    transitions.push(transition);
  }
  const migrated = sign(journalPayload({
    sourceWait,
    spec,
    phase: transitions.at(-1).phase,
    transitions,
  }), signingSecret);
  if (!verifyRetentionTimerJournal({
    journal: migrated,
    contract,
    signingSecret,
  })) {
    throw new Error(
      'legacy retention timer journal could not be migrated without changing its authority',
    );
  }
  injectCrash(crashInjector, 'before_timer_journal_schema_migration');
  writeTimerJournal(sourceWait.timerJournalPath, migrated, journal);
  injectCrash(crashInjector, 'after_timer_journal_schema_migration');
  const committed = readTimerJournal(
    sourceWait.timerJournalPath,
    contract,
    signingSecret,
  );
  if (committed.schemaVersion !== RETENTION_TIMER_JOURNAL_SCHEMA
      || canonicalJson(committed) !== canonicalJson(migrated)) {
    throw new Error('retention timer journal schema migration changed on readback');
  }
  return committed;
}

function exactPersistedWait({ contract, waitPath, signingSecret }) {
  if (!verifyRetentionWaitContract(contract, signingSecret)
      || contract.persisted !== true
      || contract.waitPath !== path.resolve(waitPath)
      || !DIGEST.test(String(contract.sourceStatusDigest || ''))) {
    throw new Error('persisted retention wait contract is invalid');
  }
  const persisted = readOwnerOnlyJson(waitPath, contract.stateRootIdentity);
  if (!verifyRetentionWaitContract(persisted, signingSecret)
      || persisted.persisted !== true
      || canonicalJson(waitBase(persisted)) !== canonicalJson(waitBase(contract))) {
    throw new Error('persisted retention wait publication does not match the requested contract');
  }
  const sourceWait = sign(waitBase(persisted), signingSecret);
  if (persisted.timerInstalled === false
      && canonicalJson(persisted) !== canonicalJson(sourceWait)) {
    throw new Error('persisted retention wait publication is not the exact source state');
  }
  if (persisted.timerInstalled === true
      && persisted.sourceWaitDigest !== digestRecord(sourceWait)) {
    throw new Error('installed retention wait publication is not an idempotent successor');
  }
  if (contract.timerInstalled === true
      && contract.timerReleased === persisted.timerReleased
      && canonicalJson(contract) !== canonicalJson(persisted)) {
    throw new Error('requested retention wait successor differs from durable state');
  }
  return { persisted, sourceWait };
}

function buildInstalledWait({
  persisted,
  sourceWait,
  spec,
  installedAt,
  installationReceipt,
  signingSecret,
}) {
  if (persisted.timerInstalled === true) {
    if (persisted.timerReleased === true
        || persisted.timerUnit !== spec.timerUnit
        || persisted.timerServiceUnit !== spec.serviceUnit
        || persisted.timerSpecDigest !== spec.specDigest
        || persisted.sourceWaitDigest !== digestRecord(sourceWait)) {
      throw new Error('authenticated retention timer publication does not match the installed unit');
    }
    if (canonicalJson(persisted.timerInstallationReceipt)
        === canonicalJson(installationReceipt)
        && persisted.timerInstalledAt === installedAt) {
      return persisted;
    }
    if (!timerInstallationReceiptValid(installationReceipt, spec, installedAt)) {
      throw new Error('repaired retention wait requires an exact manager/unit receipt');
    }
    return sign({
      ...unsigned(persisted),
      supersededInstalledWaitDigest: digestRecord(persisted),
      timerInstallationReceipt: structuredClone(installationReceipt),
      timerInstallationRevision:
        (persisted.timerInstallationRevision || 0) + 1,
      timerInstalledAt: installedAt,
    }, signingSecret);
  }
  if (!timerInstallationReceiptValid(installationReceipt, spec, installedAt)) {
    throw new Error('installed retention wait requires an exact manager/unit receipt');
  }
  return sign({
    ...unsigned(persisted),
    sourceWaitDigest: digestRecord(sourceWait),
    timerInstalled: true,
    timerInstallationReceipt: structuredClone(installationReceipt),
    timerUnit: spec.timerUnit,
    timerServiceUnit: spec.serviceUnit,
    timerSpecDigest: spec.specDigest,
    timerInstalledAt: installedAt,
  }, signingSecret);
}

function publishInstalledWait({
  persisted,
  sourceWait,
  spec,
  waitPath,
  installedAt,
  installationReceipt,
  signingSecret,
}) {
  const installed = buildInstalledWait({
    persisted,
    sourceWait,
    spec,
    installedAt,
    installationReceipt,
    signingSecret,
  });
  if (canonicalJson(installed) === canonicalJson(persisted)) return persisted;
  atomicOwnerOnlyJson(
    waitPath,
    installed,
    installed.stateRootIdentity,
    { expectedDigest: digestRecord(persisted) },
  );
  const committed = readOwnerOnlyJson(waitPath, installed.stateRootIdentity);
  if (!verifyRetentionWaitContract(committed, signingSecret)
      || canonicalJson(committed) !== canonicalJson(installed)) {
    throw new Error('installed retention wait successor changed before readback');
  }
  return committed;
}

function invalidatePromotedTimerInstallation({
  journal,
  sourceWait,
  spec,
  persisted,
  durableUnitObservationDigest,
  recordedAt,
  signingSecret,
}) {
  if (journal.phase === 'install_invalidated') return journal;
  if (!['installed', 'install_repair'].includes(journal.phase)
      || persisted.timerInstalled !== true
      || persisted.timerReleased !== false
      || !DIGEST.test(String(durableUnitObservationDigest || ''))) {
    throw new Error(
      'cannot invalidate a timer installation outside its promoted successor boundary',
    );
  }
  const predecessor = journal;
  const invalidated = advanceTimerJournal({
    journal,
    sourceWait,
    spec,
    phase: 'install_invalidated',
    evidence: {
      durableUnitObservationDigest,
      installedWaitDigest: digestRecord(persisted),
      installationReceiptDigest:
        digestRecord(persisted.timerInstallationReceipt),
      reason: 'post_promotion_authority_revalidation_failed',
    },
    recordedAt,
    signingSecret,
  });
  writeTimerJournal(sourceWait.timerJournalPath, invalidated, predecessor);
  const committed = readTimerJournal(
    sourceWait.timerJournalPath,
    persisted,
    signingSecret,
  );
  if (canonicalJson(committed) !== canonicalJson(invalidated)) {
    throw new Error('invalidated timer-install successor changed before readback');
  }
  return committed;
}

function invalidateUnpromotedTimerInstallation({
  journal,
  sourceWait,
  spec,
  persisted,
  recordedAt,
  signingSecret,
}) {
  if (journal.phase === 'install_invalidated') return journal;
  const installation = latestTimerInstallationTransition(journal);
  const exactUnpromotedPredecessor = persisted.timerInstalled === false
    || (persisted.timerInstalled === true
      && installation?.phase === 'install_repair'
      && installation.evidence?.supersededInstalledWaitDigest
        === digestRecord(persisted));
  if (!['installed', 'install_repair'].includes(journal.phase)
      || !exactUnpromotedPredecessor
      || persisted.timerReleased !== false
      || !DIGEST.test(String(
        installation?.evidence?.durableUnitObservationDigest || '',
      ))
      || !DIGEST.test(String(installation?.evidence?.installedWaitDigest || ''))
      || !isRecord(installation?.evidence?.installationReceipt)) {
    throw new Error(
      'cannot invalidate an unpromoted timer installation outside its confirmed successor boundary',
    );
  }
  const predecessor = journal;
  const invalidated = advanceTimerJournal({
    journal,
    sourceWait,
    spec,
    phase: 'install_invalidated',
    evidence: {
      durableUnitObservationDigest:
        installation.evidence.durableUnitObservationDigest,
      installedWaitDigest: installation.evidence.installedWaitDigest,
      installationReceiptDigest:
        digestRecord(installation.evidence.installationReceipt),
      reason: 'pre_promotion_authority_revalidation_failed',
    },
    recordedAt,
    signingSecret,
  });
  writeTimerJournal(sourceWait.timerJournalPath, invalidated, predecessor);
  const committed = readTimerJournal(
    sourceWait.timerJournalPath,
    persisted,
    signingSecret,
  );
  if (canonicalJson(committed) !== canonicalJson(invalidated)) {
    throw new Error(
      'pre-promotion invalidated timer-install successor changed before readback',
    );
  }
  return committed;
}

function invalidateUnobservableTimerInstallationPromotion({
  journal,
  sourceWait,
  spec,
  persisted,
  recordedAt,
  signingSecret,
}) {
  if (journal.phase === 'install_invalidated') return journal;
  const installation = latestTimerInstallationTransition(journal);
  if (!['installed', 'install_repair'].includes(journal.phase)
      || !isRecord(persisted)
      || !DIGEST.test(String(
        installation?.evidence?.durableUnitObservationDigest || '',
      ))
      || !DIGEST.test(String(installation?.evidence?.installedWaitDigest || ''))
      || !isRecord(installation?.evidence?.installationReceipt)) {
    throw new Error(
      'cannot invalidate an unobservable timer promotion outside its confirmed successor boundary',
    );
  }
  const predecessor = journal;
  const invalidated = advanceTimerJournal({
    journal,
    sourceWait,
    spec,
    phase: 'install_invalidated',
    evidence: {
      durableUnitObservationDigest:
        installation.evidence.durableUnitObservationDigest,
      installedWaitDigest: installation.evidence.installedWaitDigest,
      installationReceiptDigest:
        digestRecord(installation.evidence.installationReceipt),
      reason: 'promotion_outcome_unobservable',
    },
    recordedAt,
    signingSecret,
  });
  writeTimerJournal(sourceWait.timerJournalPath, invalidated, predecessor);
  const committed = readTimerJournal(
    sourceWait.timerJournalPath,
    persisted,
    signingSecret,
  );
  if (canonicalJson(committed) !== canonicalJson(invalidated)) {
    throw new Error(
      'unobservable timer-promotion invalidation changed before readback',
    );
  }
  return committed;
}

function retentionTimerLockFileStatSafe(stat, stateRootIdentity) {
  if (!stat.isFile() || stat.nlink !== 1) return false;
  if (stateRootIdentity.production !== true) {
    return stat.uid === stateRootIdentity.uid
      && stat.gid === stateRootIdentity.gid
      && (stat.mode & 0o777) === 0o600;
  }
  return stat.uid === stateRootIdentity.serviceUid
    && stat.gid === stateRootIdentity.serviceGid
    && (stat.mode & 0o777) === 0o600;
}

function openRetentionKernelFlock(contract) {
  let expected = null;
  const logicalHelperPath = contract.fixtureOnly === true
    ? RETENTION_HELPER_PATHS.flock
    : contract.resumeExecution?.helperPaths?.flock;
  if (!SAFE_ABSOLUTE_PATH.test(String(logicalHelperPath || ''))) {
    throw new Error('retention kernel exclusion helper path is not signed');
  }
  const helperPath = contract.fixtureOnly === true
    ? logicalHelperPath
    : retentionRuntimePath(contract, logicalHelperPath);
  const namedBeforeOpen = fs.lstatSync(helperPath);
  const helperUid = contract.fixtureOnly === true ? namedBeforeOpen.uid : 0;
  const helperGid = contract.fixtureOnly === true ? namedBeforeOpen.gid : 0;
  const helperAncestors = [];
  for (let ancestor = path.dirname(helperPath);;) {
    helperAncestors.push(ancestor);
    if (ancestor === '/') break;
    ancestor = path.dirname(ancestor);
  }
  for (const ancestor of helperAncestors.reverse()) {
    const stat = fs.lstatSync(ancestor);
    if (!stat.isDirectory() || stat.isSymbolicLink()
        || stat.uid !== helperUid || stat.gid !== helperGid
        || (stat.mode & 0o7022) !== 0) {
      throw new Error('retention kernel exclusion helper ancestor is unsafe');
    }
  }
  if (contract.fixtureOnly !== true) {
    assertRetentionRuntimeClosure(contract);
    expected = contract.resumeExecution.runtimeClosure.entries.find((entry) => (
      entry.role === 'helper_executable' && entry.path === logicalHelperPath
    ));
  }
  const descriptor = fs.openSync(
    helperPath,
    fs.constants.O_RDONLY
      | (fs.constants.O_NOFOLLOW || 0)
      | (fs.constants.O_CLOEXEC || 0),
  );
  try {
    const stat = fs.fstatSync(descriptor, { bigint: true });
    const named = fs.lstatSync(helperPath, { bigint: true });
    const bytes = fs.readFileSync(descriptor);
    const observedMode = (Number(stat.mode) & 0o7777).toString(8).padStart(4, '0');
    if (!stat.isFile() || !named.isFile() || named.isSymbolicLink()
        || stat.dev !== named.dev || stat.ino !== named.ino
        || Number(stat.uid) !== helperUid || Number(stat.gid) !== helperGid
        || (Number(stat.mode) & 0o7022) !== 0
        || (Number(stat.mode) & 0o100) === 0
        || Number(stat.size) !== bytes.length
        || (expected !== null && (
          expected.uid !== Number(stat.uid)
          || expected.gid !== Number(stat.gid)
          || expected.mode !== observedMode
          || expected.bytes !== bytes.length
          || expected.sha256 !== sha256Bytes(bytes)
        ))) {
      throw new Error('retention kernel exclusion helper changed or is unsafe');
    }
    let loaderDescriptor = null;
    if (contract.fixtureOnly !== true && !retentionRuntimeIsActive(contract)) {
      loaderDescriptor = fs.openSync(
        retentionRuntimePath(
          contract,
          contract.resumeExecution.runtimeClosure.loaderPath,
        ),
        fs.constants.O_RDONLY
          | (fs.constants.O_NOFOLLOW || 0)
          | (fs.constants.O_CLOEXEC || 0),
      );
    }
    return { descriptor, loaderDescriptor };
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}

function acquireAuthenticatedRetentionTimerLock(contract, signingSecret) {
  if (!verifyRetentionWaitContract(contract, signingSecret)
      || ![false, true].includes(contract.persisted)) {
    throw new Error('retention timer lock requires an authenticated wait');
  }
  const lockPath = `${contract.timerJournalPath}.lock`;
  if (!SAFE_ABSOLUTE_PATH.test(lockPath)) {
    throw new Error('retention timer lock path is unsafe');
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const handle = openProtectedStateTarget(lockPath, contract.stateRootIdentity);
    let descriptor = null;
    let created = false;
    try {
      try {
        descriptor = fs.openSync(
          handle.targetView,
          fs.constants.O_RDWR
            | (fs.constants.O_NOFOLLOW || 0)
            | (fs.constants.O_CLOEXEC || 0),
        );
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        try {
          descriptor = fs.openSync(
            handle.targetView,
            fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR
              | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_CLOEXEC || 0),
            protectedStateFileMode(contract.stateRootIdentity),
          );
          created = true;
          if (contract.stateRootIdentity.production === true) {
            fs.fchownSync(
              descriptor,
              contract.stateRootIdentity.serviceUid,
              contract.stateRootIdentity.serviceGid,
            );
          }
        } catch (createError) {
          if (createError.code === 'EEXIST') {
            handle.close();
            continue;
          }
          throw createError;
        }
      }
      let lockedStat = fs.fstatSync(descriptor);
      if (!retentionTimerLockFileStatSafe(lockedStat, contract.stateRootIdentity)) {
        throw new Error('retention timer kernel lock file is unsafe');
      }
      if ((lockedStat.mode & 0o777) !== protectedStateFileMode(contract.stateRootIdentity)) {
        fs.fchmodSync(descriptor, protectedStateFileMode(contract.stateRootIdentity));
        lockedStat = fs.fstatSync(descriptor);
      }
      fs.fsyncSync(descriptor);
      if (created) fs.fsyncSync(handle.parentDescriptor);
      const flockRuntime = openRetentionKernelFlock(contract);
      let acquired;
      try {
        const useRuntimeLoader = flockRuntime.loaderDescriptor !== null;
        const libraryPath = contract.fixtureOnly === true
          ? null
          : contract.resumeExecution.runtimeClosure.libraryPaths
            .map((target) => retentionRuntimePath(contract, target))
            .join(':');
        acquired = spawnSync(
          useRuntimeLoader ? '/proc/self/fd/5' : '/proc/self/fd/4',
          useRuntimeLoader
            ? [
              '--inhibit-cache',
              '--library-path',
              libraryPath,
              '/proc/self/fd/4',
              '--exclusive',
              '--nonblock',
              '3',
            ]
            : ['--exclusive', '--nonblock', '3'],
          {
            encoding: 'utf8',
            env: FIXED_HELPER_ENVIRONMENT,
            stdio: [
              'ignore',
              'pipe',
              'pipe',
              descriptor,
              flockRuntime.descriptor,
              ...(useRuntimeLoader ? [flockRuntime.loaderDescriptor] : []),
            ],
          },
        );
      } finally {
        fs.closeSync(flockRuntime.descriptor);
        if (flockRuntime.loaderDescriptor !== null) {
          fs.closeSync(flockRuntime.loaderDescriptor);
        }
      }
      if (acquired.error || acquired.status === null || acquired.signal !== null) {
        throw new Error(
          `retention timer kernel exclusion failed: ${
            acquired.error?.message || acquired.signal || 'unknown failure'
          }`,
        );
      }
      if (acquired.status === 1) {
        throw new Error('retention timer identity is locked by a live installer or reconciler');
      }
      if (acquired.status !== 0) {
        throw new Error(
          `retention timer kernel exclusion failed: ${
            String(acquired.stderr || '').trim() || `flock exited ${acquired.status}`
          }`,
        );
      }
      const afterLock = fs.fstatSync(descriptor, { bigint: true });
      const namedAfterLock = fs.lstatSync(handle.targetView, { bigint: true });
      if (!afterLock.isFile() || !namedAfterLock.isFile()
          || afterLock.dev !== namedAfterLock.dev || afterLock.ino !== namedAfterLock.ino
          || Number(afterLock.nlink) !== 1
          || !retentionTimerLockFileStatSafe(
            fs.fstatSync(descriptor),
            contract.stateRootIdentity,
          )) {
        throw new Error('retention timer kernel lock pathname changed during acquisition');
      }
      handle.assertNamedChain();
      let released = false;
      return {
        lockPath,
        release() {
          if (released) return;
          released = true;
          try {
            handle.assertNamedChain();
          } finally {
            fs.closeSync(descriptor);
            descriptor = null;
            handle.close();
          }
        },
      };
    } catch (error) {
      if (descriptor !== null) fs.closeSync(descriptor);
      handle.close();
      throw error;
    }
  }
  throw new Error('retention timer kernel lock creation did not stabilize');
}

function retentionTimerHelperPaths(contract, { systemctl = null, busctl = null } = {}) {
  if (contract.fixtureOnly === true) {
    const resolvedSystemctl = systemctl || RETENTION_HELPER_PATHS.systemctl;
    return {
      systemctl: resolvedSystemctl,
      busctl: busctl || path.join(path.dirname(resolvedSystemctl), 'busctl'),
    };
  }
  const signed = contract.resumeExecution?.helperPaths;
  if (!exactObjectKeys(signed, ['busctl', 'flock', 'getfacl', 'git', 'systemctl'])
      || (systemctl !== null && systemctl !== signed.systemctl)
      || (busctl !== null && busctl !== signed.busctl)) {
    throw new Error('retention timer helper override differs from the signed runtime closure');
  }
  return {
    systemctl: signed.systemctl,
    busctl: signed.busctl,
  };
}

function descriptorBoundRetentionCommandRunner(contract, commandRunner) {
  if (contract.fixtureOnly === true) return commandRunner;
  assertRetentionRuntimeClosure(contract);
  const expectedEntries = new Map(
    contract.resumeExecution.runtimeClosure.entries.map((entry) => [entry.path, entry]),
  );
  return (requestedPath, argv, options = {}) => {
    if (![contract.resumeExecution.helperPaths.systemctl,
      contract.resumeExecution.helperPaths.busctl].includes(requestedPath)) {
      throw new Error('retention attempted an unsigned runtime helper');
    }
    const expected = expectedEntries.get(requestedPath);
    const physicalRequestedPath = retentionRuntimePath(contract, requestedPath);
    const descriptor = fs.openSync(
      physicalRequestedPath,
      fs.constants.O_RDONLY
        | (fs.constants.O_NOFOLLOW || 0)
        | (fs.constants.O_CLOEXEC || 0),
    );
    try {
      const observed = fs.fstatSync(descriptor);
      const named = fs.lstatSync(physicalRequestedPath);
      const bytes = fs.readFileSync(descriptor);
      if (expected?.role !== 'helper_executable'
          || !observed.isFile() || !named.isFile() || named.isSymbolicLink()
          || observed.dev !== named.dev || observed.ino !== named.ino
          || observed.uid !== expected.uid || observed.gid !== expected.gid
          || (observed.mode & 0o7777).toString(8).padStart(4, '0') !== expected.mode
          || observed.size !== expected.bytes || bytes.length !== expected.bytes
          || sha256Bytes(bytes) !== expected.sha256) {
        throw new Error('retention runtime helper changed before descriptor execution');
      }
      if (retentionRuntimeIsActive(contract)) {
        return commandRunner('/proc/self/fd/3', argv, {
          ...options,
          env: FIXED_HELPER_ENVIRONMENT,
          stdio: ['ignore', 'pipe', 'pipe', descriptor],
        });
      }
      const loaderDescriptor = fs.openSync(
        retentionRuntimePath(
          contract,
          contract.resumeExecution.runtimeClosure.loaderPath,
        ),
        fs.constants.O_RDONLY
          | (fs.constants.O_NOFOLLOW || 0)
          | (fs.constants.O_CLOEXEC || 0),
      );
      try {
        const libraryPath = contract.resumeExecution.runtimeClosure.libraryPaths
          .map((target) => retentionRuntimePath(contract, target))
          .join(':');
        return commandRunner('/proc/self/fd/4', [
          '--inhibit-cache',
          '--library-path',
          libraryPath,
          '/proc/self/fd/3',
          ...argv,
        ], {
          ...options,
          env: FIXED_HELPER_ENVIRONMENT,
          stdio: ['ignore', 'pipe', 'pipe', descriptor, loaderDescriptor],
        });
      } finally {
        fs.closeSync(loaderDescriptor);
      }
    } finally {
      fs.closeSync(descriptor);
    }
  };
}

function installRetentionResumeTimerUnlocked({
  contract,
  waitPath,
  signingSecret,
  systemctl = null,
  busctl = null,
  commandRunner = spawnSync,
  dryRun = false,
  now = null,
  crashInjector = null,
} = {}) {
  const recordedAt = operationNow(now);
  let { persisted, sourceWait } = exactPersistedWait({
    contract,
    waitPath,
    signingSecret,
  });
  const helpers = retentionTimerHelperPaths(sourceWait, { systemctl, busctl });
  const resolvedSystemctl = helpers.systemctl;
  const resolvedBusctl = helpers.busctl;
  if (!SAFE_ABSOLUTE_PATH.test(String(resolvedSystemctl || ''))
      || !SAFE_ABSOLUTE_PATH.test(String(resolvedBusctl || ''))) {
    throw new Error('retention timer executables are unsafe');
  }
  const boundCommandRunner = descriptorBoundRetentionCommandRunner(
    sourceWait,
    commandRunner,
  );
  const spec = buildRetentionTimerSpec(sourceWait);
  const command = [resolvedSystemctl, 'enable', '--now', spec.timerUnit];
  let journal = readTimerJournal(sourceWait.timerJournalPath, persisted, signingSecret);
  if (journal === null && persisted.timerInstalled === true) {
    throw new Error('authenticated installed timer is missing its durable journal');
  }
  if (journal !== null) {
    journal = migrateLegacyTimerJournal({
      journal,
      contract: persisted,
      sourceWait,
      spec,
      signingSecret,
      crashInjector,
    });
  }
  if (journal !== null
      && Date.parse(recordedAt) < Date.parse(journal.transitions.at(-1).recordedAt)) {
    throw new Error('retention timer operation time predates the durable journal');
  }
  if (dryRun === true) {
    return {
      contract: persisted,
      journal,
      command,
      dryRun: true,
      reconciled: false,
      timerSpecDigest: spec.specDigest,
    };
  }

  if (journal === null) {
    journal = initialTimerJournal({
      sourceWait,
      spec,
      recordedAt,
      signingSecret,
    });
    injectCrash(crashInjector, 'before_pending_publication');
    writeTimerJournal(sourceWait.timerJournalPath, journal);
    injectCrash(crashInjector, 'after_pending');
  }
  if (['fired', 'released'].includes(journal.phase)) {
    return {
      contract: persisted,
      journal,
      command,
      dryRun: false,
      reconciled: true,
      timerSpecDigest: spec.specDigest,
    };
  }

  let inspection;
  let adopted;
  try {
    publishDurableTimerUnits(spec, crashInjector);
    injectCrash(crashInjector, 'after_unit_publication');
    reloadDurableTimerManager(resolvedSystemctl, boundCommandRunner, crashInjector);
    inspection = inspectRetentionTimer(spec, {
      systemctl: resolvedSystemctl,
      busctl: resolvedBusctl,
      commandRunner: boundCommandRunner,
      allowFired: Date.parse(recordedAt) >= Date.parse(spec.resumeAt),
    });
    if (inspection.exists && !inspection.identityExact) {
      throw new Error(
        `retention timer identity or content mismatch: ${
          inspection.identityMismatches.join('; ')
        }`,
      );
    }
    adopted = inspection.exact;
    if (!inspection.exists || !inspection.activationExact) {
      activateDurableTimer(resolvedSystemctl, spec, boundCommandRunner, crashInjector);
      injectCrash(crashInjector, 'after_external_create');
      inspection = inspectRetentionTimer(spec, {
        systemctl: resolvedSystemctl,
        busctl: resolvedBusctl,
        commandRunner: boundCommandRunner,
        allowFired: Date.parse(recordedAt) >= Date.parse(spec.resumeAt),
      });
      if (!inspection.exact) {
        throw new Error(
          `retention timer installation failed or mismatched after durable activation: ${
            inspection.mismatches.join('; ')
          }`,
        );
      }
      adopted = false;
    }
  } catch (error) {
    if (persisted.timerInstalled === true
        && persisted.timerReleased === false
        && error?.[INJECTED_RETENTION_CRASH] !== true
        && ['installed', 'install_repair'].includes(journal.phase)) {
      journal = invalidatePromotedTimerInstallation({
        journal,
        sourceWait,
        spec,
        persisted,
        durableUnitObservationDigest:
          installedDurableUnitObservation(journal)?.observationDigest,
        recordedAt,
        signingSecret,
      });
    }
    throw error;
  }
  if (journal.phase === 'pending') {
    const predecessor = journal;
    journal = advanceTimerJournal({
      journal,
      sourceWait,
      spec,
      phase: 'created',
      evidence: {
        adopted,
        timerServiceUnit: spec.serviceUnit,
        timerSpecDigest: spec.specDigest,
        timerUnit: spec.timerUnit,
      },
      recordedAt,
      signingSecret,
    });
    writeTimerJournal(sourceWait.timerJournalPath, journal, predecessor);
    injectCrash(crashInjector, 'after_created');
  }
  if (journal.phase === 'created') {
    inspection = inspectRetentionTimer(spec, {
      systemctl: resolvedSystemctl,
      busctl: resolvedBusctl,
      commandRunner: boundCommandRunner,
      allowFired: Date.parse(recordedAt) >= Date.parse(spec.resumeAt),
    });
    if (inspection.exists && !inspection.identityExact) {
      throw new Error(
        `retention timer inspection identity mismatch: ${
          inspection.identityMismatches.join('; ')
        }`,
      );
    }
    if (!inspection.exists || !inspection.activationExact) {
      activateDurableTimer(resolvedSystemctl, spec, boundCommandRunner, crashInjector);
      inspection = inspectRetentionTimer(spec, {
        systemctl: resolvedSystemctl,
        busctl: resolvedBusctl,
        commandRunner: boundCommandRunner,
        allowFired: Date.parse(recordedAt) >= Date.parse(spec.resumeAt),
      });
    }
    if (!inspection.exact) {
      throw new Error(`retention timer inspection mismatch: ${inspection.mismatches.join('; ')}`);
    }
    const durableUnitObservation = observeDurableTimerUnits(spec, crashInjector);
    const predecessor = journal;
    journal = advanceTimerJournal({
      journal,
      sourceWait,
      spec,
      phase: 'inspected',
      evidence: {
        durableUnitObservation,
        durableUnitObservationDigest: durableUnitObservation.observationDigest,
        inspection: {
          service: structuredClone(inspection.service),
          timer: structuredClone(inspection.timer),
        },
        inspectionDigest: inspection.inspectionDigest,
        timerServiceUnit: spec.serviceUnit,
        timerSpecDigest: spec.specDigest,
        timerUnit: spec.timerUnit,
      },
      recordedAt,
      signingSecret,
    });
    writeTimerJournal(sourceWait.timerJournalPath, journal, predecessor);
    injectCrash(crashInjector, 'after_inspected');
  }
  if (![
    'inspected',
    'install_pending',
    'installed',
    'install_invalidated',
    'install_repair',
  ].includes(journal.phase)) {
    throw new Error('retention timer journal did not reach an installable state');
  }
  let inspectedDurableUnitObservation = installedDurableUnitObservation(journal);
  if (journal.phase === 'install_invalidated') {
    // The privileged broker may have recreated a missing exact unit after the
    // invalidation. Bind that new root-owned inode set in the repair successor;
    // never inherit the pre-drift unit identity merely because the bytes match.
    inspectedDurableUnitObservation = observeDurableTimerUnits(
      spec,
      crashInjector,
    );
  }
  const existingInstalledTransition = latestTimerInstallationTransition(journal);
  let installedAt = existingInstalledTransition?.recordedAt || recordedAt;
  let installationReceipt =
    existingInstalledTransition?.evidence?.installationReceipt || null;
  let prospectiveInstalledWait = installationReceipt === null
    ? null
    : buildInstalledWait({
      persisted,
      sourceWait,
      spec,
      installedAt,
      installationReceipt,
      signingSecret,
    });
  let expectedInstalledWaitDigest = prospectiveInstalledWait === null
    ? null
    : digestRecord(prospectiveInstalledWait);
  let installedWaitPromoted = persisted.timerInstalled === true
    && existingInstalledTransition?.evidence?.installedWaitDigest
      === digestRecord(persisted);
  let installedAuthorityConfirmed = false;
  let unpromotedInstallationConfirmed = !installedWaitPromoted
    && ['installed', 'install_repair'].includes(journal.phase);
  let installedWaitPromotionAttempted = false;
  const inspectExactInstallationManager = (boundary) => {
    injectCrash(crashInjector, boundary);
    const current = inspectRetentionTimer(spec, {
      systemctl: resolvedSystemctl,
      busctl: resolvedBusctl,
      commandRunner: boundCommandRunner,
      allowFired: Date.parse(recordedAt) >= Date.parse(spec.resumeAt),
    });
    if (!current.exact) {
      throw new Error(
        `retention timer manager changed across installed successor boundary: ${
          current.mismatches.join('; ')
        }`,
      );
    }
    return current;
  };
  const confirmInstalledAuthority = () => revalidateDurableTimerUnitPublication(
    spec,
    inspectedDurableUnitObservation,
    crashInjector,
    (observation, assertPinnedPublication) => {
      let pending = journal.transitions.find(
        (transition) => transition.phase === 'install_pending',
      );
      let confirmationBaseline = null;
      if (journal.phase === 'inspected') {
        const freshInspection = inspectExactInstallationManager(
          'before_install_pending_manager_inspection',
        );
        confirmationBaseline = freshInspection;
        assertPinnedPublication();
        const predecessor = journal;
        journal = advanceTimerJournal({
          journal,
          sourceWait,
          spec,
          phase: 'install_pending',
          evidence: {
            durableUnitObservation: observation,
            durableUnitObservationDigest: observation.observationDigest,
            inspection: {
              service: structuredClone(freshInspection.service),
              timer: structuredClone(freshInspection.timer),
            },
            inspectionDigest: freshInspection.inspectionDigest,
            timerServiceUnit: spec.serviceUnit,
            timerSpecDigest: spec.specDigest,
            timerUnit: spec.timerUnit,
          },
          recordedAt: installedAt,
          signingSecret,
        });
        writeTimerJournal(sourceWait.timerJournalPath, journal, predecessor);
        injectCrash(crashInjector, 'after_install_pending');
        const committedPending = readTimerJournal(
          sourceWait.timerJournalPath,
          persisted,
          signingSecret,
        );
        if (canonicalJson(committedPending) !== canonicalJson(journal)) {
          throw new Error('pending timer-install successor changed before readback');
        }
        journal = committedPending;
        pending = journal.transitions.at(-1);
        injectCrash(crashInjector, 'after_install_pending_readback');
      }
      if (pending?.evidence?.durableUnitObservationDigest
            !== observation.observationDigest
          && ['inspected', 'install_pending'].includes(journal.phase)) {
        throw new Error('pending timer-install successor differs from the current exact unit pair');
      }
      if (confirmationBaseline === null) {
        confirmationBaseline = inspectExactInstallationManager(
          'before_install_pending_retry_manager_inspection',
        );
      }

      const confirmedInspection = inspectExactInstallationManager(
        'before_install_pending_manager_reinspection',
      );
      if (confirmedInspection.inspectionDigest
          !== confirmationBaseline.inspectionDigest) {
        throw new Error(
          'retention timer manager identity or activation changed during pending confirmation',
        );
      }
      assertPinnedPublication();
      injectCrash(crashInjector, 'after_install_pending_manager_reinspection');

      if (journal.phase === 'install_pending') {
        installationReceipt = buildTimerInstallationReceipt({
          spec,
          durableUnitObservationDigest: observation.observationDigest,
          managerInspectionDigest: confirmedInspection.inspectionDigest,
          managerIdentityDigest: retentionTimerManagerIdentityDigest({
            service: confirmedInspection.service,
            timer: confirmedInspection.timer,
          }, {
            includeInvocationGeneration: true,
          }),
          timerInvocationId: confirmedInspection.timer.InvocationID,
          confirmedAt: installedAt,
        });
        prospectiveInstalledWait = buildInstalledWait({
          persisted,
          sourceWait,
          spec,
          installedAt,
          installationReceipt,
          signingSecret,
        });
        expectedInstalledWaitDigest = digestRecord(prospectiveInstalledWait);
        const predecessor = journal;
        journal = advanceTimerJournal({
          journal,
          sourceWait,
          spec,
          phase: 'installed',
          evidence: {
            durableUnitObservationDigest: observation.observationDigest,
            installedWaitDigest: expectedInstalledWaitDigest,
            installationReceipt: structuredClone(installationReceipt),
            pendingInspectionDigest: pending.evidence.inspectionDigest,
            pendingJournalDigest: digestRecord(predecessor),
            inspection: {
              service: structuredClone(confirmedInspection.service),
              timer: structuredClone(confirmedInspection.timer),
            },
            inspectionDigest: confirmedInspection.inspectionDigest,
          },
          recordedAt: installedAt,
          signingSecret,
        });
        writeTimerJournal(sourceWait.timerJournalPath, journal, predecessor);
        injectCrash(crashInjector, 'after_install_confirmed');
        const committedInstalledJournal = readTimerJournal(
          sourceWait.timerJournalPath,
          persisted,
          signingSecret,
        );
        if (canonicalJson(committedInstalledJournal) !== canonicalJson(journal)) {
          throw new Error('confirmed timer-install journal changed before readback');
        }
        journal = committedInstalledJournal;
        unpromotedInstallationConfirmed = true;
      }
      let installedTransition = latestTimerInstallationTransition(journal);
      const currentManagerIdentityDigest =
        retentionTimerManagerIdentityDigest({
          service: confirmedInspection.service,
          timer: confirmedInspection.timer,
        }, {
          includeInvocationGeneration:
            installationReceiptManagerIdentityIncludesGeneration(
              installationReceipt,
            ),
        });
      const receiptIdentityMatchesCurrent = installationReceipt !== null
        && installationReceipt.managerIdentityDigest
          === currentManagerIdentityDigest
        && (!installationReceiptExposesManagerGeneration(
          installationReceipt,
        ) || installationReceipt.timerInvocationId
          === confirmedInspection.timer.InvocationID);
      const receiptMatchesCurrent = receiptIdentityMatchesCurrent
        && installationReceipt.managerInspectionDigest
          === confirmedInspection.inspectionDigest;
      if (installedTransition !== null
          && (journal.phase === 'install_invalidated'
            || !installationReceiptExposesManagerGeneration(
              installationReceipt,
            )
            || (persisted.timerInstalled !== true && !receiptMatchesCurrent)
            || (persisted.timerInstalled === true
              && !receiptIdentityMatchesCurrent))) {
        const supersededReceipt = installationReceipt;
        const repairsPublishedWait = persisted.timerInstalled === true;
        const supersededInstalledWaitDigest = repairsPublishedWait
          ? digestRecord(persisted)
          : null;
        installedAt = recordedAt;
        installationReceipt = buildTimerInstallationReceipt({
          spec,
          durableUnitObservationDigest: observation.observationDigest,
          managerInspectionDigest: confirmedInspection.inspectionDigest,
          managerIdentityDigest: retentionTimerManagerIdentityDigest({
            service: confirmedInspection.service,
            timer: confirmedInspection.timer,
          }, {
            includeInvocationGeneration: true,
          }),
          timerInvocationId: confirmedInspection.timer.InvocationID,
          confirmedAt: installedAt,
        });
        prospectiveInstalledWait = buildInstalledWait({
          persisted,
          sourceWait,
          spec,
          installedAt,
          installationReceipt,
          signingSecret,
        });
        expectedInstalledWaitDigest = digestRecord(prospectiveInstalledWait);
        const predecessor = journal;
        journal = advanceTimerJournal({
          journal,
          sourceWait,
          spec,
          phase: 'install_repair',
          evidence: {
            durableUnitObservationDigest: observation.observationDigest,
            ...(pending.evidence.durableUnitObservationDigest
                !== observation.observationDigest
              ? { durableUnitObservation: observation }
              : {}),
            installedWaitDigest: expectedInstalledWaitDigest,
            installationReceipt: structuredClone(installationReceipt),
            inspection: {
              service: structuredClone(confirmedInspection.service),
              timer: structuredClone(confirmedInspection.timer),
            },
            inspectionDigest: confirmedInspection.inspectionDigest,
            supersededInstallationReceiptDigest:
              digestRecord(supersededReceipt),
            ...(repairsPublishedWait
              ? { supersededInstalledWaitDigest }
              : {}),
          },
          recordedAt: installedAt,
          signingSecret,
        });
        writeTimerJournal(sourceWait.timerJournalPath, journal, predecessor);
        injectCrash(crashInjector, 'after_install_repair');
        const committedRepairJournal = readTimerJournal(
          sourceWait.timerJournalPath,
          persisted,
          signingSecret,
        );
        if (canonicalJson(committedRepairJournal) !== canonicalJson(journal)) {
          throw new Error('timer-install repair successor changed before readback');
        }
        journal = committedRepairJournal;
        unpromotedInstallationConfirmed = persisted.timerInstalled === false;
        const repairRetry = new Error(
          'retention timer manager generation changed; repair successor recorded and retry is required',
        );
        repairRetry[TIMER_INSTALL_REPAIR_RETRY] = true;
        throw repairRetry;
      }
      installedTransition = latestTimerInstallationTransition(journal);
      const promotingInstalledWait = canonicalJson(prospectiveInstalledWait)
        !== canonicalJson(persisted);
      if (installationReceipt === null
          || prospectiveInstalledWait === null
          || expectedInstalledWaitDigest === null
          || installedTransition?.evidence?.installedWaitDigest
            !== expectedInstalledWaitDigest
          || installedTransition.evidence.durableUnitObservationDigest
            !== observation.observationDigest
          || canonicalJson(installedTransition.evidence.installationReceipt)
            !== canonicalJson(installationReceipt)
          || (promotingInstalledWait
            && (persisted.timerInstalled === true
              ? !receiptIdentityMatchesCurrent
              : !receiptMatchesCurrent))) {
        throw new Error('confirmed timer-install journal differs from its promoted wait');
      }
      const promotionInspection = inspectExactInstallationManager(
        'before_installed_wait_promotion_manager_inspection',
      );
      if (promotionInspection.inspectionDigest
          !== confirmedInspection.inspectionDigest) {
        throw new Error(
          'retention timer manager identity or activation changed before installed promotion',
        );
      }
      assertPinnedPublication();
      injectCrash(crashInjector, 'before_installed_wait_promotion');
      installedWaitPromotionAttempted = true;
      persisted = publishInstalledWait({
        persisted,
        sourceWait,
        spec,
        waitPath,
        installedAt,
        installationReceipt,
        signingSecret,
      });
      installedWaitPromoted = true;
      unpromotedInstallationConfirmed = false;
      if (digestRecord(persisted) !== expectedInstalledWaitDigest) {
        throw new Error('installed wait promotion differs from its confirmed successor');
      }
      injectCrash(
        crashInjector,
        'after_installed_wait_promotion_before_manager_reinspection',
      );
      const promotedInspection = inspectExactInstallationManager(
        'before_installed_wait_promotion_manager_reinspection',
      );
      if (promotedInspection.inspectionDigest
          !== promotionInspection.inspectionDigest
          || installationReceipt.timerInvocationId
            !== promotedInspection.timer.InvocationID
          || (promotingInstalledWait
            && retentionTimerManagerIdentityDigest({
              service: promotedInspection.service,
              timer: promotedInspection.timer,
            }, {
              includeInvocationGeneration:
                installationReceiptManagerIdentityIncludesGeneration(
                  installationReceipt,
                ),
            }) !== installationReceipt.managerIdentityDigest)) {
        throw new Error(
          'retention timer manager identity or activation changed across installed promotion',
        );
      }
      assertPinnedPublication();
      injectCrash(
        crashInjector,
        'after_installed_wait_promotion_manager_reinspection',
      );
      injectCrash(crashInjector, 'after_installed');
    },
    (observation, assertPinnedPublication) => {
      const handoffInspection = inspectExactInstallationManager(
        'before_installed_authority_handoff_manager_inspection',
      );
      const handoffIdentityDigest = retentionTimerManagerIdentityDigest({
        service: handoffInspection.service,
        timer: handoffInspection.timer,
      }, {
        includeInvocationGeneration:
          installationReceiptManagerIdentityIncludesGeneration(
            installationReceipt,
          ),
      });
      const installedTransition = latestTimerInstallationTransition(journal);
      if (installationReceipt === null
          || persisted.timerInstalled !== true
          || persisted.timerReleased !== false
          || persisted.timerInstallationReceipt.managerIdentityDigest
            !== handoffIdentityDigest
          || persisted.timerInstallationReceipt.timerInvocationId
            !== handoffInspection.timer.InvocationID
          || installationReceipt.managerIdentityDigest !== handoffIdentityDigest
          || installationReceipt.timerInvocationId
            !== handoffInspection.timer.InvocationID
          || installedTransition?.evidence?.installedWaitDigest
            !== digestRecord(persisted)
          || installedTransition.evidence.durableUnitObservationDigest
            !== observation.observationDigest) {
        throw new Error(
          'retention timer manager or installed successor changed before protected authority handoff',
        );
      }
      assertPinnedPublication();
      injectCrash(
        crashInjector,
        'after_installed_authority_handoff_manager_inspection',
      );
      const installedSuccessorConsumed = readOwnerOnlyJson(
        waitPath,
        sourceWait.stateRootIdentity,
        {
          consume(committedInstalledWait) {
            if (!verifyRetentionWaitContract(
              committedInstalledWait,
              signingSecret,
            )
                || canonicalJson(committedInstalledWait)
                  !== canonicalJson(persisted)
                || digestRecord(committedInstalledWait)
                  !== installedTransition.evidence.installedWaitDigest) {
              throw new Error(
                'installed wait successor changed before protected authority consumption',
              );
            }
            const installedJournalConsumed = readTimerJournal(
              sourceWait.timerJournalPath,
              committedInstalledWait,
              signingSecret,
              {
                consume(committedInstalledJournal) {
                  if (canonicalJson(committedInstalledJournal)
                        !== canonicalJson(journal)
                      || latestTimerInstallationTransition(
                        committedInstalledJournal,
                      )?.evidence?.installedWaitDigest
                        !== digestRecord(committedInstalledWait)) {
                    throw new Error(
                      'installed timer journal changed before protected authority consumption',
                    );
                  }
                  return true;
                },
              },
            );
            if (installedJournalConsumed !== true) {
              throw new Error(
                'installed timer journal was not consumed during its protected authority handoff',
              );
            }
            return true;
          },
        },
      );
      if (installedSuccessorConsumed !== true) {
        throw new Error(
          'installed timer successor was not consumed during its protected authority handoff',
        );
      }
      injectCrash(
        crashInjector,
        'after_installed_successor_authority_consumption',
      );
      assertPinnedPublication();
      const confirmedHandoffInspection = inspectExactInstallationManager(
        'before_installed_authority_handoff_manager_reinspection',
      );
      const confirmedHandoffIdentityDigest =
        retentionTimerManagerIdentityDigest({
          service: confirmedHandoffInspection.service,
          timer: confirmedHandoffInspection.timer,
        }, {
          includeInvocationGeneration:
            installationReceiptManagerIdentityIncludesGeneration(
              installationReceipt,
            ),
        });
      if (confirmedHandoffInspection.inspectionDigest
            !== handoffInspection.inspectionDigest
          || confirmedHandoffIdentityDigest !== handoffIdentityDigest
          || installationReceipt.timerInvocationId
            !== confirmedHandoffInspection.timer.InvocationID) {
        throw new Error(
          'retention timer manager changed across the protected installed authority handoff',
        );
      }
      assertPinnedPublication();
      return true;
    },
  );
  try {
    confirmInstalledAuthority();
    installedAuthorityConfirmed = true;
  } catch (error) {
    if (installedWaitPromotionAttempted
        && !installedWaitPromoted
        && !installedAuthorityConfirmed
        && error?.[INJECTED_RETENTION_CRASH] !== true
        && error?.[TIMER_INSTALL_REPAIR_RETRY] !== true
        && ['installed', 'install_repair'].includes(journal.phase)) {
      // A CAS can fail before rename, or it can commit and then lose its
      // readback. Re-read the protected name once. An exact confirmed
      // successor is a post-promotion failure; the exact predecessor is a
      // pre-promotion failure. Any other/missing state is deliberately not
      // guessed: the signed journal records an unobservable promotion outcome
      // and requires an authenticated repair retry.
      let observedWait = null;
      try {
        const candidate = readOwnerOnlyJson(
          waitPath,
          sourceWait.stateRootIdentity,
        );
        if (verifyRetentionWaitContract(candidate, signingSecret)
            && canonicalJson(waitBase(candidate))
              === canonicalJson(waitBase(sourceWait))) {
          observedWait = candidate;
        }
      } catch {}
      const installedTransition = latestTimerInstallationTransition(journal);
      if (observedWait?.timerInstalled === true
          && observedWait.timerReleased === false
          && digestRecord(observedWait)
            === installedTransition?.evidence?.installedWaitDigest) {
        persisted = observedWait;
        installedWaitPromoted = true;
        unpromotedInstallationConfirmed = false;
      } else if (canonicalJson(observedWait) === canonicalJson(persisted)
          && (observedWait?.timerInstalled === false
            || (observedWait?.timerInstalled === true
              && installedTransition?.phase === 'install_repair'
              && installedTransition.evidence?.supersededInstalledWaitDigest
                === digestRecord(observedWait)))) {
        unpromotedInstallationConfirmed = true;
      } else {
        journal = invalidateUnobservableTimerInstallationPromotion({
          journal,
          sourceWait,
          spec,
          persisted,
          recordedAt,
          signingSecret,
        });
      }
    }
    if (installedWaitPromoted
        && !installedAuthorityConfirmed
        && error?.[INJECTED_RETENTION_CRASH] !== true
        && ['installed', 'install_repair'].includes(journal.phase)
        && latestTimerInstallationTransition(journal)
          ?.evidence?.installedWaitDigest === digestRecord(persisted)) {
      journal = invalidatePromotedTimerInstallation({
        journal,
        sourceWait,
        spec,
        persisted,
        durableUnitObservationDigest:
          inspectedDurableUnitObservation.observationDigest,
        recordedAt,
        signingSecret,
      });
    } else if (unpromotedInstallationConfirmed
        && !installedAuthorityConfirmed
        && error?.[INJECTED_RETENTION_CRASH] !== true
        && error?.[TIMER_INSTALL_REPAIR_RETRY] !== true
        && ['installed', 'install_repair'].includes(journal.phase)) {
      journal = invalidateUnpromotedTimerInstallation({
        journal,
        sourceWait,
        spec,
        persisted,
        recordedAt,
        signingSecret,
      });
    }
    throw error;
  }
  return {
    contract: persisted,
    journal,
    command,
    dryRun: false,
    reconciled: adopted || contract.timerInstalled === true,
    timerSpecDigest: spec.specDigest,
  };
}

function writeExactRelease(releasePath, expectedBytes, stateRootIdentity) {
  if (!Buffer.isBuffer(expectedBytes)) {
    throw new Error('retention release successor requires one exact byte serialization');
  }
  if (protectedStateFileExists(releasePath, stateRootIdentity)) {
    const existingBytes = readOwnerOnlyBytes(releasePath, stateRootIdentity);
    if (!existingBytes.equals(expectedBytes)) {
      throw new Error('retention release successor already exists with different bytes');
    }
    atomicOwnerOnlyBytes(
      releasePath,
      expectedBytes,
      stateRootIdentity,
      { expectedDigest: null },
    );
    return true;
  }
  atomicOwnerOnlyBytes(
    releasePath,
    expectedBytes,
    stateRootIdentity,
    { expectedDigest: null },
  );
  return false;
}

function processRetentionResumeTimerFiringUnlocked({
  contract,
  waitPath,
  signingSecret,
  releaseBuilder = null,
  releaseInputs = null,
  firingSpecDigest = null,
  systemctl = null,
  busctl = null,
  commandRunner = spawnSync,
  dryRun = false,
  now = null,
  crashInjector = null,
} = {}) {
  const recordedAt = operationNow(now);
  const { persisted } = exactPersistedWait({
    contract,
    waitPath,
    signingSecret,
  });
  if (dryRun === true) {
    return {
      contract: persisted,
      journal: readTimerJournal(
        persisted.timerJournalPath,
        persisted,
        signingSecret,
      ),
      command: [...persisted.resumeCommand],
      dryRun: true,
      reconciled: false,
      timerSpecDigest: buildRetentionTimerSpec(persisted).specDigest,
      release: null,
      released: false,
    };
  }
  let durableWait = readOwnerOnlyJson(waitPath, contract.stateRootIdentity);
  if (durableWait.timerInstalled !== true) {
    throw new Error(
      'retention timer firing requires prior privileged installation and inspection',
    );
  }
  const sourceWait = sign(waitBase(durableWait), signingSecret);
  assertRetentionResumeRuntimeIdentity(sourceWait);
  const helpers = retentionTimerHelperPaths(sourceWait, { systemctl, busctl });
  const boundCommandRunner = descriptorBoundRetentionCommandRunner(
    sourceWait,
    commandRunner,
  );
  const spec = buildRetentionTimerSpec(sourceWait);
  let journal = readTimerJournal(sourceWait.timerJournalPath, durableWait, signingSecret);
  if (!journal || ![
    'installed',
    'install_repair',
    'fired',
    'released',
  ].includes(journal.phase)) {
    throw new Error('retention timer is not durably installed');
  }
  journal = migrateLegacyTimerJournal({
    journal,
    contract: durableWait,
    sourceWait,
    spec,
    signingSecret,
    crashInjector,
  });
  if (Date.parse(recordedAt) < Date.parse(spec.resumeAt)) {
    throw new Error('retention timer release is premature');
  }
  if (['installed', 'install_repair'].includes(journal.phase)) {
    if (firingSpecDigest !== spec.specDigest) {
      throw new Error('retention timer firing identity is missing or mismatched');
    }
    const inspectedDurableUnitObservation =
      installedDurableUnitObservation(journal);
    const durableUnitObservation = revalidateDurableTimerUnitPublication(
      spec,
      inspectedDurableUnitObservation,
      crashInjector,
      (observation, assertPinnedPublication) => {
        injectCrash(
          crashInjector,
          'before_fired_manager_inspection',
        );
        const inspection = inspectRetentionTimer(spec, {
          systemctl: helpers.systemctl,
          busctl: helpers.busctl,
          commandRunner: boundCommandRunner,
          allowFired: true,
        });
        const externallyFiredAt = inspectedTimerFiredAt(
          inspection,
          spec,
          recordedAt,
        );
        if (externallyFiredAt === null) {
          throw new Error(
            `retention timer has no exact fired evidence: ${
              inspection.mismatches.join('; ')
            }`,
          );
        }
        const managerFiringReceipt = buildManagerFiringReceipt({
          inspection,
          spec,
          firedAt: externallyFiredAt,
        });
        assertPinnedPublication();
        const predecessor = journal;
        journal = advanceTimerJournal({
          journal,
          sourceWait,
          spec,
          phase: 'fired',
          evidence: {
            durableUnitObservation: observation,
            durableUnitObservationDigest: observation.observationDigest,
            firedAt: externallyFiredAt,
            firingSpecDigest,
            inspectedDurableUnitObservationDigest:
              inspectedDurableUnitObservation.observationDigest,
            inspection: {
              service: structuredClone(inspection.service),
              timer: structuredClone(inspection.timer),
            },
            inspectionDigest: inspection.inspectionDigest,
            managerFiringReceipt,
            managerIdentityDigest: retentionTimerManagerIdentityDigest({
              service: inspection.service,
              timer: inspection.timer,
            }, {
              includeInvocationGeneration: true,
            }),
          },
          recordedAt,
          signingSecret,
        });
        writeTimerJournal(sourceWait.timerJournalPath, journal, predecessor);
        injectCrash(
          crashInjector,
          'after_fired_journal_write_before_readback',
        );
        const committedFiredJournal = readTimerJournal(
          sourceWait.timerJournalPath,
          durableWait,
          signingSecret,
        );
        if (canonicalJson(committedFiredJournal) !== canonicalJson(journal)) {
          throw new Error(
            'authenticated fired journal changed before its pinned unit commit completed',
          );
        }
        journal = committedFiredJournal;
        injectCrash(
          crashInjector,
          'before_fired_manager_commit_witness',
        );
        const committedInspection = inspectRetentionTimer(spec, {
          systemctl: helpers.systemctl,
          busctl: helpers.busctl,
          commandRunner: boundCommandRunner,
          allowFired: true,
        });
        const committedFiredAt = inspectedTimerFiredAt(
          committedInspection,
          spec,
          recordedAt,
        );
        if (!committedInspection.exists
            || committedFiredAt === null
            || committedFiredAt !== externallyFiredAt
            || !managerFiringGenerationMatchesInspection(
              managerFiringReceipt,
              committedInspection,
              spec,
            )
            || retentionTimerManagerIdentityDigest({
              service: committedInspection.service,
              timer: committedInspection.timer,
            }, {
              includeInvocationGeneration: true,
            }) !== retentionTimerManagerIdentityDigest({
              service: inspection.service,
              timer: inspection.timer,
            }, {
              includeInvocationGeneration: true,
            })) {
          throw new Error(
            `retention timer manager firing changed across fired journal commit: ${
              (!committedInspection.exists
                ? 'service and timer are absent from the current manager'
                : committedInspection.mismatches.join('; '))
                || `LastTriggerUSec mismatch (expected ${
                  externallyFiredAt
                }, observed ${committedFiredAt})`
            }`,
          );
        }
        assertPinnedPublication();
        injectCrash(
          crashInjector,
          'after_fired_journal_write_before_unit_revalidation',
        );
      },
      (_observation, assertPinnedPublication) => {
        const firedTransition = journal.transitions.find(
          (transition) => transition.phase === 'fired',
        );
        injectCrash(
          crashInjector,
          'before_fired_authority_handoff_manager_inspection',
        );
        const handoffInspection = inspectRetentionTimer(spec, {
          systemctl: helpers.systemctl,
          busctl: helpers.busctl,
          commandRunner: boundCommandRunner,
          allowFired: true,
        });
        const handoffFiredAt = inspectedTimerFiredAt(
          handoffInspection,
          spec,
          recordedAt,
        );
        const handoffIdentityDigest = handoffInspection.exists
          ? retentionTimerManagerIdentityDigest({
            service: handoffInspection.service,
            timer: handoffInspection.timer,
          }, {
            includeInvocationGeneration: true,
          })
          : null;
        if (!handoffInspection.exists
            || handoffFiredAt === null
            || handoffFiredAt !== firedTransition?.evidence?.firedAt
            || !managerFiringGenerationMatchesInspection(
              firedTransition?.evidence?.managerFiringReceipt,
              handoffInspection,
              spec,
            )
            || handoffIdentityDigest
              !== firedTransition?.evidence?.managerIdentityDigest) {
          throw new Error(
            'retention timer manager firing changed before the protected fired-journal handoff',
          );
        }
        assertPinnedPublication();
        injectCrash(
          crashInjector,
          'after_fired_authority_handoff_manager_inspection',
        );
        const firedJournalConsumed = readTimerJournal(
          sourceWait.timerJournalPath,
          durableWait,
          signingSecret,
          {
            consume(committedFiredJournal) {
              const committedFiredTransition =
                committedFiredJournal.transitions.find(
                  (transition) => transition.phase === 'fired',
                );
              if (canonicalJson(committedFiredJournal)
                    !== canonicalJson(journal)
                  || committedFiredJournal.phase !== 'fired'
                  || committedFiredTransition?.evidence
                    ?.managerFiringReceipt?.managerIdentityDigest
                    !== handoffIdentityDigest
                  || committedFiredTransition?.evidence?.firedAt
                    !== handoffFiredAt) {
                throw new Error(
                  'fired timer journal changed before protected authority consumption',
                );
              }
              return true;
            },
          },
        );
        if (firedJournalConsumed !== true) {
          throw new Error(
            'fired timer journal was not consumed during its protected authority handoff',
          );
        }
        injectCrash(
          crashInjector,
          'after_fired_successor_authority_consumption',
        );
        assertPinnedPublication();
        const confirmedHandoffInspection = inspectRetentionTimer(spec, {
          systemctl: helpers.systemctl,
          busctl: helpers.busctl,
          commandRunner: boundCommandRunner,
          allowFired: true,
        });
        const confirmedHandoffFiredAt = inspectedTimerFiredAt(
          confirmedHandoffInspection,
          spec,
          recordedAt,
        );
        const confirmedHandoffIdentityDigest =
          confirmedHandoffInspection.exists
            ? retentionTimerManagerIdentityDigest({
              service: confirmedHandoffInspection.service,
              timer: confirmedHandoffInspection.timer,
            }, {
              includeInvocationGeneration: true,
            })
            : null;
        if (!confirmedHandoffInspection.exists
            || confirmedHandoffFiredAt !== handoffFiredAt
            || !managerFiringGenerationMatchesInspection(
              firedTransition?.evidence?.managerFiringReceipt,
              confirmedHandoffInspection,
              spec,
            )
            || confirmedHandoffIdentityDigest !== handoffIdentityDigest) {
          throw new Error(
            'retention timer manager firing changed across the protected fired-journal handoff',
          );
        }
        assertPinnedPublication();
        return true;
      },
    );
    const firedDurableUnitObservation = journal.transitions.find(
      (transition) => transition.phase === 'fired',
    )?.evidence?.durableUnitObservation;
    if (canonicalJson(durableUnitObservation)
        !== canonicalJson(firedDurableUnitObservation)) {
      throw new Error(
        'fired journal durable unit evidence differs from the pinned observation',
      );
    }
    injectCrash(crashInjector, 'after_fired');
  } else if (firingSpecDigest !== null && firingSpecDigest !== spec.specDigest) {
    throw new Error('retention timer retry supplied a mismatched firing identity');
  }

  const firedTransition = journal.transitions.find((transition) => (
    transition.phase === 'fired'
  ));
  const firedAt = firedTransition.evidence.firedAt;
  const inspectCurrentFiring = (boundary) => {
    injectCrash(crashInjector, boundary);
    const inspection = inspectRetentionTimer(spec, {
      systemctl: helpers.systemctl,
      busctl: helpers.busctl,
      commandRunner: boundCommandRunner,
      allowFired: true,
    });
    const currentlyFiredAt = inspectedTimerFiredAt(
      inspection,
      spec,
      recordedAt,
    );
    if (!inspection.exists
        || currentlyFiredAt === null
        || currentlyFiredAt !== firedAt
        || !managerFiringGenerationMatchesInspection(
          firedTransition.evidence.managerFiringReceipt,
          inspection,
          spec,
        )
        || retentionTimerManagerIdentityDigest({
          service: inspection.service,
          timer: inspection.timer,
        }, {
          includeInvocationGeneration: true,
        }) !== firedTransition.evidence.managerIdentityDigest) {
      throw new Error(
        `retention timer manager firing changed after authenticated commit (identity or generation mismatch): ${
          (!inspection.exists
            ? 'service and timer are absent from the current manager'
            : inspection.mismatches.join('; '))
            || `LastTriggerUSec mismatch (expected ${firedAt}, observed ${
              currentlyFiredAt
            })`
        }`,
      );
    }
    assertCurrentRetentionServiceInvocation(inspection, spec);
    return inspection;
  };
  const withCurrentFiringAuthority = (
    boundary,
    successor,
    consumeSuccessor,
  ) => {
    if (typeof successor !== 'function'
        || typeof consumeSuccessor !== 'function') {
      throw new Error(
        `retention ${boundary} successor requires commit and protected consumption`,
      );
    }
    return revalidateDurableTimerUnitPublication(
      spec,
      firedTransition.evidence.durableUnitObservation,
      crashInjector,
      (_observation, assertPinnedPublication) => {
        const before = inspectCurrentFiring(
          `before_${boundary}_manager_inspection`,
        );
        assertPinnedPublication();
        injectCrash(
          crashInjector,
          `after_${boundary}_manager_inspection_before_commit`,
        );
        successor(before);
        injectCrash(
          crashInjector,
          `after_${boundary}_successor_commit_before_manager_reinspection`,
        );
        const after = inspectCurrentFiring(
          `before_${boundary}_manager_reinspection`,
        );
        if (after.inspectionDigest !== before.inspectionDigest) {
          throw new Error(
            `retention timer manager identity or firing changed across ${boundary} commit`,
          );
        }
        assertPinnedPublication();
        injectCrash(
          crashInjector,
          `after_${boundary}_manager_reinspection`,
        );
      },
      (_observation, assertPinnedPublication) => {
        const handoffInspection = inspectCurrentFiring(
          `before_${boundary}_authority_handoff_manager_inspection`,
        );
        assertPinnedPublication();
        injectCrash(
          crashInjector,
          `after_${boundary}_authority_handoff_manager_inspection`,
        );
        const consumed = consumeSuccessor();
        if (consumed !== true) {
          throw new Error(
            `retention ${boundary} successor was not consumed during its protected authority handoff`,
          );
        }
        injectCrash(
          crashInjector,
          `after_${boundary}_successor_authority_consumption`,
        );
        assertPinnedPublication();
        const confirmedHandoffInspection = inspectCurrentFiring(
          `before_${boundary}_authority_handoff_manager_reinspection`,
        );
        if (confirmedHandoffInspection.inspectionDigest
            !== handoffInspection.inspectionDigest) {
          throw new Error(
            `retention timer manager identity or firing changed across ${boundary} protected handoff`,
          );
        }
        assertPinnedPublication();
        return true;
      },
    );
  };
  const fixtureBuilder = sourceWait.fixtureOnly === true
    && releaseInputs === null
    && typeof releaseBuilder === 'function';
  if (!isRecord(releaseInputs) && !fixtureBuilder) {
    throw new Error('retention timer due release inputs are invalid');
  }
  if (releaseInputs !== null && (
    typeof releaseInputs.fixtureOnly !== 'boolean'
    || typeof releaseInputs.task?.fixtureOnly !== 'boolean'
    || releaseInputs.fixtureOnly !== releaseInputs.task.fixtureOnly
    || releaseInputs.fixtureOnly !== sourceWait.fixtureOnly
    || (sourceWait.fixtureOnly === false && (
      releaseInputs.fixtureOnly !== false
      || releaseInputs.task.fixtureOnly !== false
    ))
  )) {
    throw new Error('retention timer release fixture mode differs from the signed wait');
  }
  if (releaseInputs !== null && (
    releaseInputs.task?.subjectId !== sourceWait.subjectId
    || releaseInputs.task?.deploymentDigest !== sourceWait.deploymentDigest
    || releaseInputs.task?.acquisitionBinding?.stateDigest
      !== sourceWait.acquisitionStateDigest
    || deploymentBindingDigest(releaseInputs.deployment)
      !== sourceWait.deploymentDigest
  )) {
    throw new Error('retention timer release plan, deployment closure, or acquisition identity mismatch');
  }
  if (releaseInputs !== null && sourceWait.fixtureOnly === false) {
    assertRetentionResumeBindings({
      bundle: releaseInputs,
      wait: sourceWait,
    });
  }
  let release = null;
  withCurrentFiringAuthority(
    'release_construction',
    () => {
      injectCrash(crashInjector, 'before_fired_manager_revalidation');
      release = fixtureBuilder
        ? releaseBuilder(firedAt)
        : releaseRetentionWindowInternal({
          ...releaseInputs,
          signingSecret,
          now: firedAt,
        }, {
          reconciledTimerFiring: true,
        });
      injectCrash(crashInjector, 'after_fired_manager_revalidation');
    },
    () => (
      isRecord(release)
      && release.releasedAt === firedAt
    ),
  );
  if (!isRecord(release) || release.releasedAt !== firedAt) {
    throw new Error('retention due release does not bind the authenticated fired time');
  }
  const releaseDigest = digestRecord(release);
  const releaseBytes = Buffer.from(`${JSON.stringify(release, null, 2)}\n`, 'utf8');
  const releaseFileSha256 = sha256Bytes(releaseBytes);
  if (journal.phase === 'fired') {
    withCurrentFiringAuthority(
      'release_file',
      () => {
        writeExactRelease(
          sourceWait.releasePath,
          releaseBytes,
          sourceWait.stateRootIdentity,
        );
        injectCrash(crashInjector, 'after_release_write');
        const committedRelease = readOwnerOnlyBytes(
          sourceWait.releasePath,
          sourceWait.stateRootIdentity,
        );
        if (!committedRelease.equals(releaseBytes)) {
          throw new Error('retention release-file successor changed before readback');
        }
      },
      () => {
        const releaseConsumed = readOwnerOnlyBytes(
          sourceWait.releasePath,
          sourceWait.stateRootIdentity,
          {
            consume(committedRelease) {
              if (!committedRelease.equals(releaseBytes)) {
                throw new Error(
                  'retention release-file successor changed before protected authority consumption',
                );
              }
              return true;
            },
          },
        );
        if (releaseConsumed !== true) {
          throw new Error(
            'retention release-file successor was not consumed during its protected authority handoff',
          );
        }
        return true;
      },
    );
    const predecessor = journal;
    const releasedJournal = advanceTimerJournal({
      journal,
      sourceWait,
      spec,
      phase: 'released',
      evidence: {
        managerFiringReceiptDigest: digestRecord(
          firedTransition.evidence.managerFiringReceipt,
        ),
        releaseDigest,
        releaseFileSha256,
        releasePath: sourceWait.releasePath,
        releasedAt: firedAt,
      },
      recordedAt,
      signingSecret,
    });
    withCurrentFiringAuthority(
      'released_journal',
      () => {
        writeTimerJournal(
          sourceWait.timerJournalPath,
          releasedJournal,
          predecessor,
        );
        injectCrash(crashInjector, 'after_released');
        const committedReleasedJournal = readTimerJournal(
          sourceWait.timerJournalPath,
          durableWait,
          signingSecret,
        );
        if (canonicalJson(committedReleasedJournal)
            !== canonicalJson(releasedJournal)) {
          throw new Error('released timer journal changed before readback');
        }
      },
      () => {
        const releasedJournalConsumed = readTimerJournal(
          sourceWait.timerJournalPath,
          durableWait,
          signingSecret,
          {
            consume(committedReleasedJournal) {
              if (canonicalJson(committedReleasedJournal)
                  !== canonicalJson(releasedJournal)) {
                throw new Error(
                  'released timer journal changed before protected authority consumption',
                );
              }
              return true;
            },
          },
        );
        if (releasedJournalConsumed !== true) {
          throw new Error(
            'released timer journal was not consumed during its protected authority handoff',
          );
        }
        return true;
      },
    );
    journal = releasedJournal;
  } else {
    const evidence = journal.transitions.at(-1).evidence;
    if (evidence.releaseDigest !== releaseDigest
        || evidence.releaseFileSha256 !== releaseFileSha256
        || evidence.releasePath !== sourceWait.releasePath) {
      throw new Error('authenticated retention release successor is inconsistent');
    }
    withCurrentFiringAuthority(
      'release_file_retry',
      () => {
        writeExactRelease(
          sourceWait.releasePath,
          releaseBytes,
          sourceWait.stateRootIdentity,
        );
        const committedRelease = readOwnerOnlyBytes(
          sourceWait.releasePath,
          sourceWait.stateRootIdentity,
        );
        if (!committedRelease.equals(releaseBytes)) {
          throw new Error('retry release-file successor changed before readback');
        }
      },
      () => {
        const retryReleaseConsumed = readOwnerOnlyBytes(
          sourceWait.releasePath,
          sourceWait.stateRootIdentity,
          {
            consume(committedRelease) {
              if (!committedRelease.equals(releaseBytes)) {
                throw new Error(
                  'retry release-file successor changed before protected authority consumption',
                );
              }
              return true;
            },
          },
        );
        if (retryReleaseConsumed !== true) {
          throw new Error(
            'retry release-file successor was not consumed during its protected authority handoff',
          );
        }
        return true;
      },
    );
  }

  withCurrentFiringAuthority(
    'released_wait',
    (releaseInspection) => {
      durableWait = readOwnerOnlyJson(waitPath, sourceWait.stateRootIdentity);
      const releasedTransition = journal.transitions.at(-1);
      if (durableWait.timerReleased === false) {
        const timerReleaseReceipt = buildTimerReleaseReceipt({
          spec,
          firedTransition,
          releasedJournal: journal,
          releaseDigest,
          releaseFileSha256,
          releaseInspection,
          confirmedAt: releasedTransition.recordedAt,
        });
        const installedWait = sign(installedWaitBase(durableWait), signingSecret);
        const releasedWait = sign({
          ...unsigned(durableWait),
          sourceInstalledWaitDigest: digestRecord(installedWait),
          timerReleased: true,
          timerFiredAt: firedAt,
          releaseDigest,
          releaseFileSha256,
          timerReleaseReceipt,
          timerReleasedAt: releasedTransition.recordedAt,
        }, signingSecret);
        atomicOwnerOnlyJson(
          waitPath,
          releasedWait,
          releasedWait.stateRootIdentity,
          { expectedDigest: digestRecord(durableWait) },
        );
        durableWait = releasedWait;
        injectCrash(crashInjector, 'after_released_wait');
      } else if (durableWait.releaseDigest !== releaseDigest
          || durableWait.releaseFileSha256 !== releaseFileSha256
          || durableWait.timerFiredAt !== firedAt
          || !timerReleaseReceiptValid(
            durableWait.timerReleaseReceipt,
            spec,
            {
              confirmedAt: releasedTransition.recordedAt,
              firedTransition,
              releaseDigest,
              releaseFileSha256,
              releasedJournal: journal,
            },
          )
          || durableWait.sourceInstalledWaitDigest
            !== digestRecord(sign(installedWaitBase(durableWait), signingSecret))) {
        throw new Error('authenticated released wait successor is inconsistent');
      }
      const committedReleasedWait = readOwnerOnlyJson(
        waitPath,
        sourceWait.stateRootIdentity,
      );
      if (!verifyRetentionWaitContract(committedReleasedWait, signingSecret)
          || canonicalJson(committedReleasedWait) !== canonicalJson(durableWait)) {
        throw new Error('released wait successor changed before readback');
      }
      const committedReleasedJournal = readTimerJournal(
        sourceWait.timerJournalPath,
        committedReleasedWait,
        signingSecret,
      );
      if (canonicalJson(committedReleasedJournal) !== canonicalJson(journal)) {
        throw new Error(
          'released wait successor does not consume the exact manager-bound journal',
        );
      }
      durableWait = committedReleasedWait;
    },
    () => readOwnerOnlyJson(
      waitPath,
      sourceWait.stateRootIdentity,
      {
        consume(committedReleasedWait) {
          if (!verifyRetentionWaitContract(
            committedReleasedWait,
            signingSecret,
          )
              || canonicalJson(committedReleasedWait)
                !== canonicalJson(durableWait)) {
            throw new Error(
              'released wait successor changed before protected authority consumption',
            );
          }
          const releasedJournalConsumed = readTimerJournal(
            sourceWait.timerJournalPath,
            committedReleasedWait,
            signingSecret,
            {
              consume(committedReleasedJournal) {
                if (canonicalJson(committedReleasedJournal)
                    !== canonicalJson(journal)) {
                  throw new Error(
                    'released wait protected authority consumption lost its exact journal',
                  );
                }
                return true;
              },
            },
          );
          if (releasedJournalConsumed !== true) {
            throw new Error(
              'released wait did not consume its exact journal during the protected authority handoff',
            );
          }
          return true;
        },
      },
    ),
  );
  return {
    contract: durableWait,
    journal,
    command: [...sourceWait.resumeCommand],
    dryRun: false,
    reconciled: true,
    released: true,
    release,
    timerSpecDigest: spec.specDigest,
  };
}

function reconcileRetentionResumeTimerUnlocked(options = {}) {
  const installed = installRetentionResumeTimerUnlocked(options);
  if (options.dryRun === true) {
    return {
      ...installed,
      release: null,
      released: false,
    };
  }
  const production = options.contract?.stateRootIdentity?.production === true;
  const repairOnly = production
    || (options.releaseInputs === undefined
      && options.releaseBuilder === undefined);
  const recordedAt = operationNow(options.now);
  let retry = null;
  if (repairOnly
      && installed.contract.timerReleased !== true
      && ['installed', 'install_repair', 'fired'].includes(installed.journal?.phase)
      && Date.parse(recordedAt) >= Date.parse(installed.contract.resumeAt)) {
    const sourceWait = sign(waitBase(installed.contract), options.signingSecret);
    const helpers = retentionTimerHelperPaths(sourceWait, {
      systemctl: options.systemctl || null,
      busctl: options.busctl || null,
    });
    const boundCommandRunner = descriptorBoundRetentionCommandRunner(
      sourceWait,
      options.commandRunner || spawnSync,
    );
    const spec = buildRetentionTimerSpec(sourceWait);
    const firedTransition = installed.journal.transitions.find(
      (transition) => transition.phase === 'fired',
    );
    const expectedObservation = firedTransition?.evidence?.durableUnitObservation
      || installedDurableUnitObservation(installed.journal);
    let retryStarted = false;
    let retryAlreadyActive = false;
    let confirmedState = null;
    const inspectAuthenticatedFiring = () => {
      const inspection = inspectRetentionTimer(spec, {
        systemctl: helpers.systemctl,
        busctl: helpers.busctl,
        commandRunner: boundCommandRunner,
        allowFired: true,
      });
      const firedAt = inspectedTimerFiredAt(inspection, spec, recordedAt);
      const installation = latestTimerInstallationTransition(installed.journal);
      const installationReceipt = installation?.evidence?.installationReceipt;
      const managerGenerationMatches = firedTransition === undefined
        ? installationReceiptExposesManagerGeneration(installationReceipt)
          && installationReceipt.timerInvocationId
            === inspection.timer?.InvocationID
          && installationReceipt.managerIdentityDigest
            === retentionTimerManagerIdentityDigest({
              service: inspection.service,
              timer: inspection.timer,
            }, { includeInvocationGeneration: true })
        : firedAt === firedTransition.evidence.firedAt
          && managerFiringGenerationMatchesInspection(
            firedTransition.evidence.managerFiringReceipt,
            inspection,
            spec,
          )
          && firedTransition.evidence.managerIdentityDigest
            === retentionTimerManagerIdentityDigest({
              service: inspection.service,
              timer: inspection.timer,
            }, { includeInvocationGeneration: true });
      if (!inspection.exact || firedAt === null || !managerGenerationMatches) {
        throw new Error(
          'unreleased retention timer retry is not bound to the authenticated manager firing generation',
        );
      }
      return inspection;
    };
    const retryIsActive = (inspection) => ['active', 'activating', 'reloading']
      .includes(inspection.service?.ActiveState);
    revalidateDurableTimerUnitPublication(
      spec,
      expectedObservation,
      options.crashInjector || null,
      (_observation, assertPinnedPublication) => {
        const inspection = inspectAuthenticatedFiring();
        if (retryIsActive(inspection)) {
          retryAlreadyActive = true;
          confirmedState = `${inspection.service.ActiveState}:${inspection.service.SubState}`;
          return;
        }
        const inactiveState = `${inspection.service?.ActiveState}:${
          inspection.service?.SubState
        }`;
        if (!['inactive:dead', 'failed:failed'].includes(inactiveState)) {
          throw new Error(
            `unreleased retention timer service has an unsafe retry state: ${inactiveState}`,
          );
        }
        assertPinnedPublication();
        restartUnreleasedRetentionService(
          helpers.systemctl,
          spec,
          boundCommandRunner,
        );
        retryStarted = true;
        assertPinnedPublication();
      },
      (_observation, assertPinnedPublication) => {
        const confirmed = inspectAuthenticatedFiring();
        if (!retryIsActive(confirmed)) {
          throw new Error(
            'unreleased retention timer service retry was not accepted by the exact manager unit',
          );
        }
        confirmedState = `${confirmed.service.ActiveState}:${confirmed.service.SubState}`;
        assertPinnedPublication();
        return true;
      },
    );
    retry = {
      serviceUnit: spec.serviceUnit,
      started: retryStarted,
      alreadyActive: retryAlreadyActive,
      confirmedState,
    };
  }
  if (production || retry?.started === true) {
    const released = installed.contract.timerReleased === true
      && installed.journal?.phase === 'released';
    return {
      ...installed,
      release: null,
      released,
      retry,
    };
  }
  return processRetentionResumeTimerFiringUnlocked({
    ...options,
    contract: installed.contract,
  });
}

function withAuthenticatedRetentionTimerLock(contract, signingSecret, operation) {
  const lock = acquireAuthenticatedRetentionTimerLock(contract, signingSecret);
  let operationError = null;
  try {
    return operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      lock.release();
    } catch (releaseError) {
      // A rejected operation has produced no authority; preserve its primary
      // diagnostic, but never let release drift pass an otherwise successful operation.
      if (operationError === null) throw releaseError;
    }
  }
}

function normalizeAndValidateRetentionRuntimeOptions(
  options,
  operation,
  { release = false } = {},
) {
  const production = options.contract?.stateRootIdentity?.production === true;
  const hasDryRun = Object.hasOwn(options, 'dryRun');
  const dryRun = hasDryRun ? options.dryRun : false;
  if (!production && typeof dryRun !== 'boolean') {
    throw new Error(`retention ${operation} dryRun must be a boolean`);
  }
  if (!production
      && dryRun === true
      && options.contract?.fixtureOnly !== true) {
    throw new Error(
      `retention ${operation} dryRun requires an authenticated fixture-only contract`,
    );
  }
  if (production) {
    const forbidden = [
      'busctl',
      'commandRunner',
      'crashInjector',
      'identitySourceReader',
      'now',
      'processIdentity',
      'systemctl',
      ...(release ? ['releaseBuilder'] : []),
    ].filter((field) => options[field] !== null && options[field] !== undefined);
    if (forbidden.length > 0) {
      throw new Error(
        `production retention ${operation} forbids injectable test authority: ${
          forbidden.join(', ')
        }`,
      );
    }
  }
  if (production && hasDryRun && dryRun !== false) {
    throw new Error(
      `production retention ${operation} forbids dryRun unless it is exactly false`,
    );
  }
  return {
    ...options,
    dryRun,
  };
}

export function installRetentionResumeTimer(options = {}) {
  const validatedOptions = normalizeAndValidateRetentionRuntimeOptions(
    options,
    'installation',
  );
  assertRetentionServiceIdentity(validatedOptions.contract?.stateRootIdentity, {
    identitySourceReader: readRootOwnedRetentionIdentitySource,
  });
  if (validatedOptions.contract?.stateRootIdentity?.production === true) {
    assertInitialRootAuthority();
  }
  return withAuthenticatedRetentionTimerLock(
    validatedOptions.contract,
    validatedOptions.signingSecret,
    () => installRetentionResumeTimerUnlocked(validatedOptions),
  );
}

export function reconcileRetentionResumeTimer(options = {}) {
  const validatedOptions = normalizeAndValidateRetentionRuntimeOptions(
    options,
    'repair',
  );
  assertRetentionServiceIdentity(validatedOptions.contract?.stateRootIdentity, {
    identitySourceReader: readRootOwnedRetentionIdentitySource,
  });
  if (validatedOptions.contract?.stateRootIdentity?.production === true) {
    assertInitialRootAuthority();
  }
  return withAuthenticatedRetentionTimerLock(
    validatedOptions.contract,
    validatedOptions.signingSecret,
    () => reconcileRetentionResumeTimerUnlocked(validatedOptions),
  );
}

export function processRetentionResumeTimerFiring(options = {}) {
  const validatedOptions = normalizeAndValidateRetentionRuntimeOptions(options, 'firing', {
    release: true,
  });
  assertRetentionResumeProcessIdentity(validatedOptions.contract?.stateRootIdentity, {
    identitySourceReader: validatedOptions.contract?.stateRootIdentity?.production === true
      ? readRootOwnedRetentionIdentitySource
      : (validatedOptions.identitySourceReader || readRootOwnedRetentionIdentitySource),
    ...(validatedOptions.processIdentity
      ? { processIdentity: validatedOptions.processIdentity }
      : {}),
  });
  // Installation and repair mutate the root-owned systemd namespace and must
  // run in the initial-namespace root broker. The due-time service is the
  // opposite side of that privilege boundary: it must remain the dedicated
  // non-root retention identity checked above. It receives no unit-mutation
  // authority; the firing path only reopens and authenticates the root-owned
  // unit pair, consumes the exact manager firing generation, and advances
  // owner-only successors under the authenticated timer lock.
  return withAuthenticatedRetentionTimerLock(
    validatedOptions.contract,
    validatedOptions.signingSecret,
    () => processRetentionResumeTimerFiringUnlocked(validatedOptions),
  );
}
