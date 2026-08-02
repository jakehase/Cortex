import crypto from 'node:crypto';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  atomicWriteSignedControlPlaneRecord,
} from './authenticated-control-publication.mjs';
import { atomicWriteAuthenticatedJson } from './authenticated-file-publication.mjs';
import {
  readAuthorityJson,
  readRootBrokeredAuthorityJson,
} from './authority-input.mjs';
import { buildAcquisitionStatus } from './acquisition-status.mjs';
import {
  validateApprovedResearchDaemonObservation,
  validateApprovedResearchRuntimeBinding,
} from './approved-research-runtime.mjs';
import { checkAnswer } from './checkers.mjs';
import {
  APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA,
  assertDeploymentBinding,
  deploymentBindingDigest,
  isFrozenDeploymentBinding,
  validateDeploymentBinding,
} from './deployment-identity.mjs';
import { generateExercise, replayGeneratedExercise, verifyGeneratedAnswer } from './generated-exercises.mjs';
import {
  validateExecutionEvidenceCore,
  executionSourceSha256,
  validateExecutionEvidenceRecord,
  verifyExecutionEvidenceBytes,
} from './execution-evidence.mjs';
import { sha256Bytes, sha256Text } from './hash.mjs';
import { validateJsonSchema } from './json-schema-validation.mjs';
import { validateResearchKernelEvidence } from './research-kernel-evidence.mjs';
import {
  parseProofRecordBytes,
  replayLeanProofEvidence,
  validateProofCandidate,
  validateKernelEvidence,
  validateProofTask,
  validateReplayEvidenceIdentity,
} from './lean-proof-verifier.mjs';
import { validateProofRuntimeEvidence } from './lean-proof-preflight.mjs';
import { CLOS_ROOT } from './paths.mjs';
import {
  buildRetentionWorkerPrompt,
  verifyProductionRetentionQualification,
} from './phd-retention.mjs';
import {
  createObligationProofTask,
  materializeProofTemplate,
  RESEARCH_ARTIFACT_MARKER,
} from './phd-proof-registry.mjs';
import {
  createProofCandidateJobTask,
  createResearchArtifactSource,
  DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA,
  PROOF_REPLAY_REQUEST_SCHEMA,
  validateProofCandidateJobTask,
} from './proof-candidate-job-task.mjs';
import { validatePhdModelCallTerminal } from './phd-terminal-contract.mjs';
import { validateIndependentAssessmentBank } from './phd-assessment.mjs';
import {
  RESEARCH_REPRODUCTION_TASK_SCHEMA,
  RESEARCH_REPRODUCTION_REQUEST_SCHEMA,
  researchSourceBundleDigest,
  serializeResearchReproductionAuthorityRequest,
  validateResearchSourceBundle,
} from './frozen-research-reproduction.mjs';
import {
  AUTHORITY_ATTESTATION_SCHEMA,
  authorityIdsForCapability,
  executionEvidencePayload,
  validateCapabilityAuthorityIndependence,
  validatePhdTrustPolicy,
  verifyAuthorityAttestation,
  verifyTrustedExecutionEvidence,
} from './phd-trust.mjs';
import { verifyMasteryState } from './mastery-state.mjs';
import {
  createResearchReviewAuthorityRequest,
  createResearchReviewRequestBinding,
  parseResearchReviewAuthorityRequestBytes,
  serializeResearchReviewAuthorityRequest,
  validateResearchReviewRequestBinding,
  validateResearchReviewRequestTask,
  validateResearchReviewResult,
} from './research-review-request.mjs';

export const PHD_CAMPAIGN_SCHEMA = 'cortex.learning_os.phd_campaign.v1';
export const PHD_CAMPAIGN_REPORT_SCHEMA = 'cortex.learning_os.phd_campaign_report.v4';
export const PROOF_REPLAY_RECEIPT_SCHEMA = 'cortex.learning_os.proof_replay_receipt.v1';
export const ACQUISITION_QUALIFICATION_RECEIPT_SCHEMA = 'cortex.learning_os.acquisition_qualification_receipt.v2';
export const RESEARCH_REPRODUCTION_BUNDLE_SCHEMA = 'cortex.learning_os.research_reproduction_bundle.v5';
export const PHD_DETACHED_JOB_SCHEMA = 'cortex.learning_os.phd_detached_job.v2';
export const PHD_DETACHED_JOB_PLAN_SCHEMA = 'cortex.learning_os.phd_detached_job_plan.v2';
export const PHD_HARVEST_STATE_SCHEMA = 'cortex.learning_os.phd_harvest_state.v2';
export const PHD_HARVEST_RECEIPT_SCHEMA = 'cortex.learning_os.phd_harvest_receipt.v1';

const DIGEST = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const PHD_CAMPAIGN_REPORT_KEYS = Object.freeze([
  'schemaVersion', 'campaignId', 'subjectId', 'evaluatedAt', 'deploymentDigest',
  'verificationBundleSha256', 'qualificationHarvestBinding', 'layers',
  'examResults', 'proofResults', 'research', 'executionEvidenceRecords', 'blockers',
  'mechanicalGatesSatisfied', 'phd_math_qualified', 'claimTruth',
  'controlPlaneSignature',
]);
const PHD_CAMPAIGN_REPORT_LAYER_KEYS = Object.freeze([
  'acquisition', 'retention', 'qualification', 'proof', 'specialization',
  'research', 'executionEvidence', 'qualificationHarvest',
]);
const QUALIFICATION_HARVEST_BINDING_KEYS = Object.freeze([
  'planDigest', 'harvestStateDigest', 'campaignDigest', 'deploymentDigest',
  'descriptorSetSha256', 'jobSetSha256', 'jobCount', 'receiptSetSha256',
  'artifactSetSha256', 'modelCallSetSha256',
]);
const QUALIFIED_CAMPAIGN_CLAIM_TRUTH = (
  'Every bounded production gate independently replayed for the exact deployment and subject. '
  + 'This is not a degree or model-weight claim.'
);
const UNQUALIFIED_CAMPAIGN_CLAIM_TRUTH = (
  'Implementation, acquisition coverage, fixture evidence, partial campaigns, or elapsed time '
  + 'do not establish retained mastery or PhD capability.'
);

export function phdCampaignVerificationBundleSha256(bundle) {
  if (!isRecord(bundle)
      || Object.hasOwn(bundle, 'signingSecret')
      || Object.hasOwn(bundle, 'verificationBundleSha256')) {
    throw new Error(
      'campaign verification bundle must contain only underlying inputs without secret or self-declared digest material',
    );
  }
  // Validate that every value has one plain JSON representation before deriving
  // the digest of the exact pretty-printed bytes committed by the authority
  // broker.  Re-parsing those brokered bytes preserves their member order, so
  // the final gate derives this same digest from the object it actually pins.
  canonicalJson(bundle);
  const serialized = JSON.stringify(bundle, null, 2);
  if (typeof serialized !== 'string') {
    throw new Error('campaign verification bundle is not JSON serializable');
  }
  return sha256Bytes(Buffer.from(`${serialized}\n`, 'utf8'));
}

const NOVELTY = new Set(['unestablished', 'bounded_corpus_only', 'externally_established']);
const PROOF_REPLAY_RECEIPT_KEYS = Object.freeze([
  'schemaVersion',
  'obligationId',
  'requestBytesBase64',
  'requestSha256',
  'kernelEvidenceDigest',
  'taskBytesSha256',
  'candidateBytesSha256',
  'templateSha256',
  'replayEvidenceDigest',
  'replayEvidence',
  'proofRuntimeEvidenceDigest',
  'proofRuntimeAttestationSha256',
  'proofRuntimeIdentitySha256',
  'proofRuntimeAuthorityId',
  'proofRuntimeVerificationKeySha256',
  'proofRuntime',
  'replaySessionId',
  'replayAuthorityId',
  'replayVerificationKeySha256',
  'replayAuthorityAttestation',
  'claimSemanticsSha256',
  'researchArtifactDigest',
  'verified',
  'truthBoundary',
  'controlPlaneSignature',
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertFixtureOnlyBoolean(fixtureOnly, label = 'fixtureOnly') {
  if (typeof fixtureOnly !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
}

function assertCampaignFixtureOnly(campaign) {
  if (!isRecord(campaign) || typeof campaign.fixtureOnly !== 'boolean') {
    throw new Error('campaign fixtureOnly must be a boolean');
  }
}

function exactKeys(value, keys) {
  return isRecord(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function hasDependencyCycle(jobs) {
  const dependencies = new Map(jobs.map((job) => [job?.jobId, job?.dependencies || []]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (jobId) => {
    if (visiting.has(jobId)) return true;
    if (visited.has(jobId)) return false;
    visiting.add(jobId);
    if ((dependencies.get(jobId) || []).some(visit)) return true;
    visiting.delete(jobId);
    visited.add(jobId);
    return false;
  };
  return [...dependencies.keys()].some(visit);
}

function digest(value) {
  return sha256Text(canonicalJson(value));
}

function canonicalEqual(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function expectedResearchDaemonMeasurement(phase, daemonClosure) {
  return {
    phase,
    closureSha256: daemonClosure?.closureSha256,
    serviceUnit: daemonClosure?.serviceUnit,
    socketPath: daemonClosure?.socketPath,
    mainPid: daemonClosure?.serviceManager?.mainPid,
    invocationId: daemonClosure?.serviceManager?.invocationId,
    cgroup: daemonClosure?.process?.cgroup,
    startTimeTicks: daemonClosure?.process?.startTimeTicks,
    socketDevice: daemonClosure?.process?.socketDevice,
    socketInode: daemonClosure?.process?.socketInode,
  };
}

function validateQualificationFamilyLedger({ campaignId, ledger, trustPolicy } = {}) {
  const errors = [];
  const priorCampaignIds = ledger?.priorCampaignIds;
  const theoremFamilyIds = ledger?.theoremFamilyIds;
  const payload = {
    campaignId,
    priorCampaignIdsDigest: digest(Array.isArray(priorCampaignIds) ? priorCampaignIds : null),
    theoremFamilyIdsDigest: digest(Array.isArray(theoremFamilyIds) ? theoremFamilyIds : null),
  };
  if (!Array.isArray(priorCampaignIds)
      || new Set(priorCampaignIds).size !== priorCampaignIds.length
      || priorCampaignIds.some((id) => !ID.test(String(id)) || id === campaignId)
      || !Array.isArray(theoremFamilyIds)
      || new Set(theoremFamilyIds).size !== theoremFamilyIds.length
      || theoremFamilyIds.some((id) => !ID.test(String(id)))) {
    errors.push('cross-campaign qualification family ledger entries are invalid');
  }
  if (!verifyAuthorityAttestation(ledger?.attestation, {
    trustPolicy,
    capability: 'qualification_family_registry',
  }) || canonicalJson(ledger?.attestation?.payload) !== canonicalJson(payload)) {
    errors.push('cross-campaign qualification family ledger is unauthenticated');
  }
  return { ok: errors.length === 0, errors };
}

function keyId(secret) {
  return sha256Text(secret).slice(0, 16);
}

function sign(payload, secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('campaign signing secret is invalid');
  return {
    ...payload,
    controlPlaneSignature: {
      algorithm: 'hmac-sha256',
      keyId: keyId(secret),
      digest: crypto.createHmac('sha256', secret).update(canonicalJson(payload)).digest('hex'),
    },
  };
}

function unsigned(record) {
  const { controlPlaneSignature: _signature, ...payload } = record;
  return payload;
}

function verifySignature(record, secret) {
  const signature = record?.controlPlaneSignature;
  if (typeof secret !== 'string' || secret.length < 32
      || !exactKeys(signature, ['algorithm', 'keyId', 'digest'])
      || signature.algorithm !== 'hmac-sha256'
      || signature.keyId !== keyId(secret)
      || !DIGEST.test(String(signature.digest || ''))) return false;
  const expected = crypto.createHmac('sha256', secret).update(canonicalJson(unsigned(record))).digest();
  const actual = Buffer.from(signature.digest, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function positiveUsage(usage) {
  return isRecord(usage) && Object.entries(usage).some(([key, value]) => (
    /(?:token|input|output|total)/i.test(key) && Number(value) > 0
  ));
}

function noToolsExecutionErrors(execution, campaign, {
  sessionId,
  promptSha256 = null,
  promptBytes = null,
  exactInputField = 'exactPromptBytes',
  role = null,
  bindings = {},
  harvestedWorkerCall = null,
} = {}) {
  const errors = [];
  if (campaign.fixtureOnly !== true) {
    if (campaign?.schemaVersion === PHD_CAMPAIGN_SCHEMA
        && harvestedWorkerCall === null) {
      errors.push('trusted production execution requires the exact harvested model-call.json');
    } else if (harvestedWorkerCall !== null
        && (canonicalJson(execution?.executionEvidenceCore)
          !== canonicalJson(harvestedWorkerCall?.executionEvidenceCore)
          || execution?.executionEvidenceSha256
            !== harvestedWorkerCall?.executionEvidenceSha256)) {
      errors.push('trusted execution core or digest differs from the exact harvested model-call.json');
    }
    const trusted = verifyTrustedExecutionEvidence({
      attestation: execution?.attestation,
      trustPolicy: campaign.trustPolicy,
      executionEvidenceCore: execution?.executionEvidenceCore,
      executionEvidenceSha256: execution?.executionEvidenceSha256,
      inputBytes: promptBytes,
      rawOutputBytes: Buffer.from(execution?.rawOutputBase64 || '', 'base64'),
      rawEventLedgerBytes: Buffer.from(execution?.rawEventLedgerBase64 || '', 'base64'),
      rawStderrBytes: Buffer.from(execution?.rawStderrBase64 || '', 'base64'),
      expected: {
        provider: campaign.modelRuntime.provider,
        model: campaign.modelRuntime.model,
        role,
        plannedSessionId: sessionId,
        promptSha256,
        bindings: {
          candidateSessionId: sessionId,
          candidateSha256: sha256Bytes(Buffer.from(execution?.rawOutputBase64 || '', 'base64')),
          campaignId: campaign.campaignId,
          campaignSha256: digest(campaign),
          deploymentSha256: campaign.deploymentDigest,
          sourceSha256: executionSourceSha256(campaign.deployment),
          ...bindings,
        },
        startedAt: execution?.startedAt,
        completedAt: execution?.completedAt,
        notBefore: campaign.frozenAt,
        notAfter: campaign.expiresAt,
        approvedExecutable: campaign.deployment.approvedModelExecutable,
        ...(harvestedWorkerCall === null ? {} : {
          command: harvestedWorkerCall.executionEvidenceCore?.command,
          observedEnvironment: harvestedWorkerCall.executionEvidenceCore?.environment?.observed,
        }),
      },
    });
    if (!trusted.ok) errors.push(...trusted.errors);
    return errors;
  }
  const startedAt = Date.parse(String(execution?.startedAt || ''));
  const completedAt = Date.parse(String(execution?.completedAt || ''));
  if (!isRecord(execution)
      || execution.provider !== campaign.modelRuntime.provider
      || execution.model !== campaign.modelRuntime.model
      || execution.thinking !== 'xhigh'
      || execution.sandbox !== 'read-only'
      || execution.toolsAllowed !== false
      || !Array.isArray(execution.toolsUsed) || execution.toolsUsed.length !== 0
      || !positiveUsage(execution.usage)
      || execution.sessionId !== sessionId) {
    errors.push('provider/model/xhigh/no-tools/usage/session evidence is invalid');
  }
  if (execution?.[exactInputField] !== true
      || (promptSha256 !== null && execution?.promptSha256 !== promptSha256)) {
    errors.push('exact prompt or task bytes are not bound');
  }
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt)
      || completedAt < startedAt
      || startedAt < Date.parse(campaign.frozenAt)
      || completedAt > Date.parse(campaign.expiresAt)) {
    errors.push('execution timestamp is stale or outside the frozen campaign');
  }
  return errors;
}

function exactBase64Bytes(value, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || (!allowEmpty && bytes.length < 1)) return null;
  return bytes;
}

function parseProofReplayRequestBytes(requestBytes) {
  const bytes = Buffer.isBuffer(requestBytes)
    ? Buffer.from(requestBytes)
    : Buffer.from(requestBytes || '');
  if (bytes.length < 2 || bytes.length > 4 * 1024 * 1024) {
    throw new Error('proof replay request bytes are absent or oversized');
  }
  let request;
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    request = JSON.parse(text);
  } catch (error) {
    throw new Error(`proof replay request bytes are not strict JSON: ${error.message}`);
  }
  const keys = [
    'schemaVersion', 'requestedCapability', 'unsigned', 'selfAttestation',
    'jobId', 'campaignId', 'obligationId', 'replaySessionId',
    'deploymentDigest', 'trustPolicyDigest', 'proofRuntimeProductDigest',
    'proofTaskSha256', 'taskBytesBase64', 'taskBytesSha256', 'candidateBytesBase64',
    'candidateBytesSha256', 'trustedTemplateBase64',
    'trustedTemplateSha256', 'theoremStatementSha256',
    'claimSemanticsSha256', 'researchArtifactDigest',
    'kernelEvidence', 'authorityReplayEvidence', 'replayAuthorityAttestation',
    'truthBoundary',
  ];
  if (text !== canonicalJson(request)
      || !exactKeys(request, keys)
      || request.schemaVersion !== PROOF_REPLAY_REQUEST_SCHEMA
      || request.requestedCapability !== 'proof_replay'
      || request.unsigned !== true
      || request.selfAttestation !== false
      || request.kernelEvidence !== null
      || request.authorityReplayEvidence !== null
      || request.replayAuthorityAttestation !== null
      || request.truthBoundary
        !== 'Candidate bytes are inert. Protected pinned-Lean execution and independent replay authority remain required.') {
    throw new Error('proof replay request fields or canonical encoding are invalid');
  }
  const taskBytes = exactBase64Bytes(request.taskBytesBase64);
  const candidateBytes = exactBase64Bytes(request.candidateBytesBase64);
  const templateBytes = exactBase64Bytes(request.trustedTemplateBase64);
  if (taskBytes === null || candidateBytes === null || templateBytes === null
      || request.taskBytesSha256 !== sha256Text(taskBytes)
      || request.candidateBytesSha256 !== sha256Text(candidateBytes)
      || request.trustedTemplateSha256 !== sha256Text(templateBytes)
      || !ID.test(String(request.jobId || ''))
      || !ID.test(String(request.campaignId || ''))
      || !ID.test(String(request.obligationId || ''))
      || !ID.test(String(request.replaySessionId || ''))
      || !DIGEST.test(String(request.deploymentDigest || ''))
      || !DIGEST.test(String(request.trustPolicyDigest || ''))
      || !DIGEST.test(String(request.proofRuntimeProductDigest || ''))
      || !DIGEST.test(String(request.proofTaskSha256 || ''))
      || !DIGEST.test(String(request.theoremStatementSha256 || ''))
      || (request.claimSemanticsSha256 !== null
        && !DIGEST.test(String(request.claimSemanticsSha256 || '')))
      || (request.researchArtifactDigest !== null
        && !DIGEST.test(String(request.researchArtifactDigest || '')))) {
    throw new Error('proof replay request identities or byte digests are invalid');
  }
  const taskEnvelope = parseProofRecordBytes(taskBytes, 'proof replay request task');
  const candidateEnvelope = parseProofRecordBytes(candidateBytes, 'proof replay request candidate');
  const taskValidation = validateProofTask(taskEnvelope.record);
  const candidateValidation = validateProofCandidate(candidateEnvelope.record, taskBytes);
  if (!taskValidation.ok || !candidateValidation.ok
      || taskEnvelope.record.conceptId !== request.obligationId
      || candidateEnvelope.record.conceptId !== request.obligationId
      || taskEnvelope.record.theorem.statementSha256 !== request.theoremStatementSha256
      || taskEnvelope.record.theorem.templateSha256 !== request.trustedTemplateSha256
      || deploymentBindingDigest(taskEnvelope.record.deployment) !== request.deploymentDigest) {
    throw new Error('proof replay request task, theorem, candidate, or deployment binding is invalid');
  }
  return {
    bytes,
    request,
    requestSha256: sha256Bytes(bytes),
    taskBytes,
    candidateBytes,
    templateBytes,
  };
}

function executionAttestationDigest(execution) {
  return isRecord(execution?.attestation) ? digest(execution.attestation) : null;
}

function authenticatedIntervalErrors({
  startedAt,
  completedAt,
  notBefore,
  notAfter,
  minimumStartedAt = null,
  label,
}) {
  const errors = [];
  const startedAtMs = Date.parse(String(startedAt || ''));
  const completedAtMs = Date.parse(String(completedAt || ''));
  const notBeforeMs = Date.parse(String(notBefore || ''));
  const notAfterMs = Date.parse(String(notAfter || ''));
  const minimumStartedAtMs = minimumStartedAt === null
    ? null
    : Date.parse(String(minimumStartedAt || ''));
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs)
      || new Date(startedAtMs).toISOString() !== startedAt
      || new Date(completedAtMs).toISOString() !== completedAt
      || !Number.isFinite(notBeforeMs) || !Number.isFinite(notAfterMs)
      || completedAtMs < startedAtMs
      || startedAtMs < notBeforeMs || completedAtMs > notAfterMs
      || (minimumStartedAtMs !== null
        && (!Number.isFinite(minimumStartedAtMs) || startedAtMs < minimumStartedAtMs))) {
    errors.push(`${label} authenticated interval is stale, pre-commit, incomplete, or out of window`);
  }
  return errors;
}

function uniqueRoleIds(roles) {
  const values = [
    ...(roles?.candidateSessions || []),
    ...(roles?.proctorIds || []),
    ...(roles?.graderIds || []),
    ...(roles?.proofCandidateSessions || []),
    ...(roles?.proofReplaySessions || []),
    roles?.researchCandidateSession,
    roles?.researchReviewerSession,
    roles?.researchReproducerSession,
    roles?.researchMaterializerSession,
    roles?.researchReviewRequestSession,
    roles?.researchReproductionRunnerSession,
    ...(roles?.retentionSessions || []),
  ].filter(Boolean);
  return values.length > 0 && values.every((value) => ID.test(String(value)))
    && new Set(values).size === values.length;
}

function mappingForTrack(rubric, tracks, offset) {
  const candidates = rubric.conceptMappings.filter((mapping) => (
    mapping.tracks.some((track) => tracks.includes(track))
    && !['research'].includes(mapping.stage)
  ));
  if (!candidates.length) throw new Error(`no assessment concepts for tracks: ${tracks.join(',')}`);
  return candidates[offset % candidates.length];
}

function boundedFrozenValue(value, label) {
  if (value === null || value === undefined) throw new Error(`research ${label} is missing`);
  const bytes = Buffer.byteLength(canonicalJson(value), 'utf8');
  if (bytes < 2 || bytes > 1024 * 1024) throw new Error(`research ${label} is outside the frozen size bound`);
  return value;
}

function validateProductionResearchProgram(researchProgram, trustPolicy, deployment) {
  const errors = [];
  const environment = researchProgram?.environment;
  const reproduction = researchProgram?.reproduction;
  const formalization = researchProgram?.formalization;
  let formalTemplate = '';
  let extractedTheoremStatement = '';
  try {
    formalTemplate = Buffer.from(formalization?.templateBase64 || '', 'base64').toString('utf8');
    const theoremStart = formalTemplate.indexOf('theorem ');
    const theoremEnd = formalTemplate.indexOf(' := ({{CORTEX_PROOF_HOLE}})');
    if (theoremStart < 0 || theoremEnd <= theoremStart) throw new Error('not extractable');
    extractedTheoremStatement = formalTemplate.slice(theoremStart, theoremEnd);
  } catch {
    // Reported by the complete formalization check below.
  }
  const sourceValidation = validateResearchSourceBundle(researchProgram?.sourceBundle);
  const runtimeValidation = validateApprovedResearchRuntimeBinding(
    deployment?.approvedResearchRuntime,
    { observe: false },
  );
  if (!sourceValidation.ok
      || researchSourceBundleDigest(researchProgram.sourceBundle) !== researchProgram?.sourceBundleSha256
      || !DIGEST.test(String(researchProgram?.sourceBundleSha256 || ''))
      || !isRecord(environment)
      || !/^sha256:[0-9a-f]{64}$/.test(String(environment.imageDigest || ''))
      || !/^sha256:[0-9a-f]{64}$/.test(String(environment.imageId || ''))
      || environment.executionKind !== 'container'
      || environment.containerRuntime !== 'docker'
      || !runtimeValidation.ok
      || deployment?.approvedResearchRuntime?.kind !== environment.containerRuntime
      || typeof environment.imageReference !== 'string'
      || !environment.imageReference.endsWith(`@${environment.imageDigest}`)
      || !DIGEST.test(String(environment.lockDigest || ''))
      || environment.immutable !== true
      || environment.networkDisabled !== true
      || !isRecord(reproduction)
      || !Array.isArray(reproduction.command) || reproduction.command.length < 1
      || reproduction.command.some((part) => typeof part !== 'string' || part.length < 1)
      || !Array.isArray(reproduction.outputPaths) || reproduction.outputPaths.length < 1
      || reproduction.outputPaths.some((part) => !/^[A-Za-z0-9._/-]+$/.test(String(part))
        || String(part).split('/').includes('..'))
      || !reproduction.outputPaths.includes(reproduction.resultPath)
      || !isRecord(formalization)
      || !ID.test(String(formalization.claimId || ''))
      || !DIGEST.test(String(formalization.claimSemanticsSha256 || ''))
      || !DIGEST.test(String(formalization.extractionSourceSha256 || ''))
      || !DIGEST.test(String(formalization.templateSha256 || ''))
      || !DIGEST.test(String(formalization.theoremStatementSha256 || ''))
      || typeof formalization.theoremStatement !== 'string'
      || typeof formalization.templateBase64 !== 'string'
      || Buffer.from(formalization.templateBase64 || '', 'base64').toString('base64')
        !== formalization.templateBase64
      || sha256Text(Buffer.from(formalization.templateBase64 || '', 'base64')) !== formalization.templateSha256
      || !formalTemplate.startsWith('import Mathlib\n')
      || formalTemplate.split('{{CORTEX_PROOF_HOLE}}').length !== 2
      || formalTemplate.includes(RESEARCH_ARTIFACT_MARKER)
      || /candidate_research_fixture_digest_binding/.test(formalTemplate)
      || extractedTheoremStatement !== formalization.theoremStatement
      || sha256Text(extractedTheoremStatement) !== formalization.theoremStatementSha256
      || digest({
        claimId: formalization.claimId,
        boundedClaim: researchProgram.boundedClaim,
        extractionSourceSha256: formalization.extractionSourceSha256,
        theoremStatement: extractedTheoremStatement,
      }) !== formalization.claimSemanticsSha256
      || !researchProgram.sourceBundle.files.some((file) => (
        file.sha256 === formalization.extractionSourceSha256
      ))
      || !Array.isArray(formalization.extractionCommand) || formalization.extractionCommand.length < 1) {
    errors.push(
      'research exact source bytes, immutable environment, reproduction command, or externally materialized formal claim is incomplete',
      ...sourceValidation.errors,
      ...runtimeValidation.errors,
    );
  }
  const expectedCorrespondence = {
    sourceBundleSha256: researchProgram?.sourceBundleSha256,
    environmentDigest: researchProgram?.environmentDigest,
    reproductionDigest: digest(reproduction),
    boundedClaimSha256: sha256Text(researchProgram?.boundedClaim || ''),
    claimId: formalization?.claimId,
    claimSemanticsSha256: formalization?.claimSemanticsSha256,
    extractionSourceSha256: formalization?.extractionSourceSha256,
    templateSha256: formalization?.templateSha256,
    theoremStatementSha256: formalization?.theoremStatementSha256,
  };
  if (!verifyAuthorityAttestation(formalization?.correspondenceAttestation, {
    trustPolicy,
    capability: 'research_correspondence',
  }) || canonicalJson(formalization.correspondenceAttestation?.payload) !== canonicalJson(expectedCorrespondence)) {
    errors.push('research artifact-to-formal-claim correspondence is not independently attested');
  }
  return { ok: errors.length === 0, errors };
}

function researchPrompt({ campaign, role, artifact = null, artifactDigest = null } = {}) {
  const base = {
    campaignId: campaign.campaignId,
    subjectId: campaign.subjectId,
    role,
    boundedClaim: campaign.researchProgram.boundedClaim,
    corpus: campaign.researchProgram.corpus,
    corpusDigest: campaign.researchProgram.corpusDigest,
    environment: campaign.researchProgram.environment,
    environmentDigest: campaign.researchProgram.environmentDigest,
    sourceBundle: campaign.researchProgram.sourceBundle,
    sourceBundleSha256: campaign.researchProgram.sourceBundleSha256,
    reproduction: campaign.researchProgram.reproduction,
    assumptions: campaign.researchProgram.assumptions,
    assumptionsDigest: campaign.researchProgram.assumptionsDigest,
    noveltyCeiling: campaign.researchProgram.noveltyCeiling,
  };
  if (role !== 'research_candidate') {
    if (!DIGEST.test(String(artifactDigest || '')) || digest(artifact) !== artifactDigest) {
      throw new Error('research review/reproduction prompt artifact binding mismatch');
    }
    base.artifact = artifact;
    base.artifactDigest = artifactDigest;
  }
  const instruction = {
    research_candidate: 'Produce the bounded artifact and result under the exact frozen corpus, environment, and assumptions. Claim no novelty beyond the declared corpus.',
    adversarial_review: 'Independently adversarially review the exact artifact against the frozen program. Do not revise or reproduce it.',
    reproduction: 'Independently reproduce the exact artifact result under the frozen environment and assumptions. Do not review or revise it.',
  }[role];
  if (!instruction) throw new Error('unknown research execution role');
  return [
    instruction,
    'Do not use tools. Return only JSON matching the assigned strict output schema.',
    canonicalJson(base),
  ].join('\n\n');
}

export function buildSealedQualificationBanks({ blueprint, rubric, seed } = {}) {
  if (typeof seed !== 'string' || seed.length < 8) throw new Error('qualification bank seed is too short');
  const specs = [
    ...blueprint.coreExams.map((spec) => ({ spec, kind: 'core' })),
    { spec: blueprint.specializationExam, kind: 'specialization' },
  ];
  const usedItemIds = new Set();
  const banks = {};
  for (const { spec, kind } of specs) {
    const problemCount = spec.minimumProblemCount;
    const tracks = spec.tracks || spec.eligibleTracks;
    const items = [];
    for (let index = 0; index < problemCount; index += 1) {
      const mapping = mappingForTrack(rubric, tracks, index);
      const item = generateExercise({
        conceptId: mapping.conceptId,
        seed: `${seed}:${spec.examId}:${String(index + 1).padStart(2, '0')}`,
        role: 'held-out',
      });
      if (usedItemIds.has(item.itemId)) throw new Error('qualification item identity collision');
      usedItemIds.add(item.itemId);
      items.push(item);
    }
    banks[spec.examId] = {
      schemaVersion: 'cortex.learning_os.sealed_exam_bank.v1',
      fixtureOnly: true,
      provenance: 'synthetic_generated_fixture',
      examId: spec.examId,
      examVersion: spec.version,
      kind,
      items,
      bankDigest: digest(items),
      keyDigest: digest(items.map((item) => ({ itemId: item.itemId, checker: item.checker }))),
      truthBoundary: 'Synthetic fixture bank for mechanics tests only. It is acquisition-derived, is not expert-reviewed, and can never qualify a production campaign.',
    };
  }
  return banks;
}

function outcomeIdsForConcept(graph, conceptId) {
  const concept = graph?.concepts?.find((row) => row.conceptId === conceptId);
  return concept?.outcomes?.map((outcome) => `outcome:${sha256Text(outcome)}`) || [];
}

function acquisitionRegistryEntry(item, bank) {
  return {
    schemaVersion: 'cortex.learning_os.acquisition_assessment_registry_entry.v2',
    assessmentId: item.itemId,
    bankId: bank.bankId,
    bankDigest: bank.bankDigest,
    itemContentDigest: item.contentDigest,
    checkerSpecificationSha256: item.checker.specificationSha256,
    conceptId: item.conceptId,
    theoremFamilyId: item.semanticFamilyId,
    assessmentClass: item.assessmentClass,
    assessmentRole: item.assessmentRole,
    productionEligible: true,
    outcomeIds: structuredClone(item.outcomeIds),
    stage: item.stage,
    trackIds: structuredClone(item.trackIds),
    trustPolicyDigest: item.bindings.trustPolicyDigest,
    deploymentDigest: item.bindings.deploymentDigest,
    campaign: structuredClone(item.bindings.campaign),
    authorAuthorityId: item.authorAttestation.authorityId,
    reviewerAuthorityId: item.reviewerAttestation.authorityId,
  };
}

export function buildAcquisitionAssessmentRegistry({
  assessmentBank,
  graph,
  rubric,
  trustPolicy,
  deployment,
} = {}) {
  const bankValidation = validateIndependentAssessmentBank(assessmentBank, {
    graph,
    rubric,
    trustPolicy,
    deployment,
    campaignBinding: assessmentBank?.bindings?.campaign,
  });
  if (!bankValidation.ok || assessmentBank.purpose !== 'acquisition') {
    throw new Error(`invalid acquisition assessment bank: ${bankValidation.errors.join('; ')}`);
  }
  const entries = [];
  for (const concept of graph?.concepts || []) {
    const matches = assessmentBank.items.filter((item) => (
      item.conceptId === concept.conceptId && item.assessmentRole === 'acquisition'
    ));
    if (matches.length !== 1) {
      throw new Error(`acquisition bank must contain exactly one primary acquisition item for ${concept.conceptId}`);
    }
    entries.push(acquisitionRegistryEntry(matches[0], assessmentBank));
  }
  return entries;
}

export function validateAcquisitionAssessmentRegistryMetadata(registry, graph = null) {
  const errors = [];
  const conceptIds = new Set();
  const assessmentIds = new Set();
  const theoremFamilyIds = new Set();
  const itemContentDigests = new Set();
  let bankBinding = null;
  const expectedConceptIds = new Set(graph?.concepts?.map((concept) => concept.conceptId) || []);
  if (!Array.isArray(registry)
      || registry.length !== (graph?.concepts?.length || 264)) {
    return { ok: false, errors: ['acquisition assessment registry must contain one entry per concept'] };
  }
  for (const entry of registry) {
    const expectedOutcomes = graph ? outcomeIdsForConcept(graph, entry?.conceptId) : null;
    if (!isRecord(entry)
        || canonicalJson(Object.keys(entry).sort()) !== canonicalJson([
          'assessmentClass',
          'assessmentId',
          'assessmentRole',
          'authorAuthorityId',
          'bankDigest',
          'bankId',
          'campaign',
          'checkerSpecificationSha256',
          'conceptId',
          'deploymentDigest',
          'itemContentDigest',
          'outcomeIds',
          'productionEligible',
          'reviewerAuthorityId',
          'schemaVersion',
          'stage',
          'theoremFamilyId',
          'trackIds',
          'trustPolicyDigest',
        ])
        || entry.schemaVersion !== 'cortex.learning_os.acquisition_assessment_registry_entry.v2'
        || !ID.test(String(entry.assessmentId || ''))
        || !ID.test(String(entry.bankId || ''))
        || !ID.test(String(entry.conceptId || ''))
        || !ID.test(String(entry.theoremFamilyId || ''))
        || !ID.test(String(entry.stage || ''))
        || !ID.test(String(entry.authorAuthorityId || ''))
        || !ID.test(String(entry.reviewerAuthorityId || ''))
        || entry.authorAuthorityId === entry.reviewerAuthorityId
        || !DIGEST.test(String(entry.bankDigest || ''))
        || !DIGEST.test(String(entry.itemContentDigest || ''))
        || !DIGEST.test(String(entry.checkerSpecificationSha256 || ''))
        || !DIGEST.test(String(entry.trustPolicyDigest || ''))
        || !DIGEST.test(String(entry.deploymentDigest || ''))
        || !isRecord(entry.campaign)
        || canonicalJson(Object.keys(entry.campaign).sort())
          !== canonicalJson(['campaignDigest', 'campaignId'])
        || !ID.test(String(entry.campaign.campaignId || ''))
        || !DIGEST.test(String(entry.campaign.campaignDigest || ''))
        || !Array.isArray(entry.trackIds) || entry.trackIds.length < 1
        || new Set(entry.trackIds).size !== entry.trackIds.length
        || entry.trackIds.some((trackId) => !ID.test(String(trackId)))
        || entry.assessmentClass !== 'independently_authored_concept_specific'
        || entry.assessmentRole !== 'acquisition'
        || entry.productionEligible !== true
        || !Array.isArray(entry.outcomeIds) || entry.outcomeIds.length < 1
        || new Set(entry.outcomeIds).size !== entry.outcomeIds.length
        || entry.outcomeIds.some((outcomeId) => !/^outcome:[0-9a-f]{64}$/.test(String(outcomeId)))
        || conceptIds.has(entry.conceptId)
        || assessmentIds.has(entry.assessmentId)
        || theoremFamilyIds.has(entry.theoremFamilyId)
        || itemContentDigests.has(entry.itemContentDigest)
        || (graph && (!expectedConceptIds.has(entry.conceptId)
          || canonicalJson(entry.outcomeIds) !== canonicalJson(expectedOutcomes)))) {
      errors.push(`invalid concept-specific acquisition assessment registry entry: ${String(entry?.conceptId || 'unknown')}`);
      continue;
    }
    conceptIds.add(entry.conceptId);
    assessmentIds.add(entry.assessmentId);
    theoremFamilyIds.add(entry.theoremFamilyId);
    itemContentDigests.add(entry.itemContentDigest);
    const currentBankBinding = {
      bankId: entry.bankId,
      bankDigest: entry.bankDigest,
      trustPolicyDigest: entry.trustPolicyDigest,
      deploymentDigest: entry.deploymentDigest,
      campaign: entry.campaign,
    };
    if (bankBinding === null) bankBinding = currentBankBinding;
    else if (canonicalJson(bankBinding) !== canonicalJson(currentBankBinding)) {
      errors.push(`acquisition registry entry crosses bank or binding boundaries: ${entry.conceptId}`);
    }
  }
  if (graph && (conceptIds.size !== expectedConceptIds.size
      || [...expectedConceptIds].some((conceptId) => !conceptIds.has(conceptId)))) {
    errors.push('acquisition assessment registry does not cover the exact committed graph');
  }
  return { ok: errors.length === 0, errors };
}

export function validateAcquisitionAssessmentRegistry(registry, graph = null) {
  return validateAcquisitionAssessmentRegistryMetadata(registry, graph);
}

export function validateProductionAcquisitionAssessmentRegistry({
  registry,
  assessmentBank,
  graph,
  rubric,
  trustPolicy,
  deployment,
  campaignBinding,
} = {}) {
  const errors = [];
  const metadata = validateAcquisitionAssessmentRegistryMetadata(registry, graph);
  errors.push(...metadata.errors);
  if (!isRecord(assessmentBank)) {
    errors.push('production acquisition registry requires the exact signed assessment bank bytes');
    return { ok: false, errors };
  }
  if (digest(graph) !== deployment?.contentDigests?.graph
      || digest(rubric) !== deployment?.contentDigests?.rubric
      || digest(trustPolicy) !== deployment?.contentDigests?.['trust-policy']) {
    errors.push('production acquisition graph, rubric, or trust policy bytes differ from deployment');
  }
  const bankValidation = validateIndependentAssessmentBank(assessmentBank, {
    graph,
    rubric,
    trustPolicy,
    deployment,
    campaignBinding,
  });
  errors.push(...bankValidation.errors.map((error) => `production acquisition bank: ${error}`));
  if (assessmentBank.purpose !== 'acquisition'
      || canonicalJson(assessmentBank.bindings?.campaign) !== canonicalJson(campaignBinding)) {
    errors.push('production acquisition bank purpose or campaign binding is invalid');
  }
  try {
    const expected = buildAcquisitionAssessmentRegistry({
      assessmentBank,
      graph,
      rubric,
      trustPolicy,
      deployment,
    });
    if (canonicalJson(registry) !== canonicalJson(expected)) {
      errors.push('production acquisition registry is not derived from the exact signed bank bytes');
    }
  } catch (error) {
    errors.push(error.message);
  }
  return { ok: errors.length === 0, errors };
}

export function validateProductionQualificationBank({
  bank,
  spec,
  kind,
  graph,
  rubric,
  trustPolicy,
  declaredSpecializationTracks,
  acquisitionAssessmentRegistry,
  qualificationFamilyLedger,
  usedFamilies,
} = {}) {
  const errors = [];
  const allowedTracks = kind === 'specialization' ? declaredSpecializationTracks : spec.tracks;
  if (!Array.isArray(acquisitionAssessmentRegistry)
      || !isRecord(qualificationFamilyLedger)
      || !Array.isArray(qualificationFamilyLedger.theoremFamilyIds)
      || !(usedFamilies instanceof Set)) {
    return {
      ok: false,
      errors: ['production qualification family registry identity is unavailable or malformed'],
    };
  }
  const reservedFamilies = new Set([
    ...acquisitionAssessmentRegistry.map((entry) => entry?.theoremFamilyId),
    ...qualificationFamilyLedger.theoremFamilyIds,
    ...usedFamilies,
  ]);
  const stagedFamilies = new Set();
  if (bank?.schemaVersion !== 'cortex.learning_os.sealed_exam_bank.v2'
      || bank.fixtureOnly !== false
      || bank.examId !== spec.examId
      || bank.examVersion !== spec.version
      || bank.kind !== kind
      || !Array.isArray(bank.items) || bank.items.length < spec.minimumProblemCount
      || digest(bank.items) !== bank.bankDigest
      || digest(bank.items.map((item) => ({ itemId: item.itemId, checker: item.checker }))) !== bank.keyDigest) {
    errors.push('bank identity, item floor, or digest is invalid');
  }
  const provenance = bank?.provenance;
  if (!isRecord(provenance)
      || provenance.mode !== 'independently_authored_expert_reviewed'
      || provenance.unavailableDuringAcquisition !== true
      || provenance.acquisitionFamilyDisjoint !== true
      || provenance.priorCampaignFamilyDisjoint !== true
      || provenance.acquisitionAssessmentRegistryDigest
        !== digest(Array.isArray(acquisitionAssessmentRegistry) ? acquisitionAssessmentRegistry : null)
      || provenance.priorQualificationFamilyLedgerDigest
        !== digest(isRecord(qualificationFamilyLedger) ? qualificationFamilyLedger : null)
      || !Array.isArray(provenance.authorIds) || provenance.authorIds.length < 1
      || !Array.isArray(provenance.expertReviewerIds) || provenance.expertReviewerIds.length < 1
      || provenance.authorIds.some((id) => provenance.expertReviewerIds.includes(id))) {
    errors.push('bank independent author/reviewer provenance is incomplete');
  }
  if (!verifyAuthorityAttestation(bank?.authorityAttestation, {
    trustPolicy,
    capability: 'bank_authoring',
    schemaVersion: AUTHORITY_ATTESTATION_SCHEMA,
  }) || canonicalJson(bank.authorityAttestation?.payload) !== canonicalJson({
    examId: bank?.examId,
    examVersion: bank?.examVersion,
    bankDigest: bank?.bankDigest,
    keyDigest: bank?.keyDigest,
    provenanceDigest: digest(bank?.provenance),
  })) {
    errors.push('bank authority attestation is invalid');
  }
  if (!verifyAuthorityAttestation(bank?.expertReviewAttestation, {
    trustPolicy,
    capability: 'bank_review',
    schemaVersion: AUTHORITY_ATTESTATION_SCHEMA,
  }) || canonicalJson(bank.expertReviewAttestation?.payload) !== canonicalJson({
    examId: bank?.examId,
    examVersion: bank?.examVersion,
    bankDigest: bank?.bankDigest,
    keyDigest: bank?.keyDigest,
    provenanceDigest: digest(bank?.provenance),
    status: 'approved',
    graduateQualificationReviewed: true,
  }) || bank.expertReviewAttestation?.authorityId === bank.authorityAttestation?.authorityId) {
    errors.push('independent authenticated expert bank review is invalid');
  }
  const coveredTracks = new Set();
  const coveredOutcomes = new Set();
  const coveredConcepts = new Set();
  const itemIds = new Set();
  for (const item of bank?.items || []) {
    const metadata = item?.qualification;
    const familyReused = ID.test(String(metadata?.theoremFamilyId || ''))
      && (reservedFamilies.has(metadata.theoremFamilyId)
        || stagedFamilies.has(metadata.theoremFamilyId));
    if (familyReused) {
      errors.push(`qualification theorem family is not disjoint: ${String(item?.itemId || 'unknown')}`);
    }
    const mapping = rubric?.conceptMappings?.find((row) => row.conceptId === metadata?.conceptId);
    const expectedOutcomes = outcomeIdsForConcept(graph, metadata?.conceptId);
    if (!ID.test(String(item?.itemId || '')) || itemIds.has(item.itemId)
        || item.generation !== undefined
        || !isRecord(item.checker)
        || metadata?.difficulty !== 'graduate_qualifying'
        || !ID.test(String(metadata?.theoremFamilyId || ''))
        || familyReused
        || coveredConcepts.has(metadata?.conceptId)
        || !mapping || !['graduate_core', 'qualifying', 'specialization'].includes(mapping.stage)
        || !Array.isArray(metadata.tracks) || metadata.tracks.length < 1
        || metadata.tracks.some((track) => !allowedTracks.includes(track) || !mapping.tracks.includes(track))
        || !Array.isArray(metadata.outcomeIds) || metadata.outcomeIds.length < 1
        || metadata.outcomeIds.some((outcomeId) => !expectedOutcomes.includes(outcomeId))) {
      errors.push(`invalid graduate item metadata: ${String(item?.itemId || 'unknown')}`);
      continue;
    }
    itemIds.add(item.itemId);
    coveredConcepts.add(metadata.conceptId);
    stagedFamilies.add(metadata.theoremFamilyId);
    metadata.tracks.forEach((track) => coveredTracks.add(track));
    metadata.outcomeIds.forEach((outcome) => coveredOutcomes.add(outcome));
  }
  if (allowedTracks.some((track) => !coveredTracks.has(track))) errors.push('bank does not cover every declared track');
  if (coveredConcepts.size < spec.minimumProblemCount) errors.push('bank concept coverage is too narrow');
  if (coveredOutcomes.size < spec.minimumProblemCount) errors.push('bank outcome coverage is too narrow');
  if (errors.length === 0) {
    stagedFamilies.forEach((familyId) => usedFamilies.add(familyId));
  }
  return { ok: errors.length === 0, errors };
}

export function buildCandidateExamRelease({ campaign, examId, sealedBank, releasedAt } = {}) {
  assertCampaignFixtureOnly(campaign);
  const exam = campaign?.exams?.find((row) => row.examId === examId);
  if (!exam || sealedBank?.examId !== examId
      || digest(sealedBank.items) !== exam.bankDigest
      || sealedBank.keyDigest !== exam.keyDigest) throw new Error('sealed exam bank substitution');
  if (Date.parse(releasedAt) <= Date.parse(exam.commitmentRecordedAt)) {
    throw new Error('exam prompt was released before its commitment');
  }
  return {
    schemaVersion: 'cortex.learning_os.candidate_exam_release.v1',
    campaignId: campaign.campaignId,
    subjectId: campaign.subjectId,
    examId,
    releasedAt,
    promptCommitmentDigest: exam.promptCommitmentDigest,
    items: sealedBank.items.map((item) => ({
      itemId: item.itemId,
      prompt: item.prompt,
      answerFormat: item.answerFormat,
    })),
    candidateKeyMaterialIncluded: false,
    truthBoundary: 'Candidate release omits checkers, key digests, grading thresholds, and bank metadata.',
  };
}

function examPrompt(release) {
  return [
    'Complete this declared-unseen sealed examination without tools.',
    'Return only JSON matching {"answers":[{"itemId":"...","answer":"..."}]}; answer every item exactly once.',
    canonicalJson(release),
  ].join('\n\n');
}

export function buildExamJobDescriptors({ campaign, sealedBanks, releasedAtByExam } = {}) {
  assertCampaignFixtureOnly(campaign);
  return campaign.exams.map((exam) => {
    const release = buildCandidateExamRelease({
      campaign,
      examId: exam.examId,
      sealedBank: sealedBanks?.[exam.examId],
      releasedAt: releasedAtByExam?.[exam.examId],
    });
    return {
      jobId: `${campaign.campaignId}.${exam.examId}`,
      role: 'exam',
      sessionId: exam.candidateSessionId,
      prompt: examPrompt(release),
      outputSchema: 'model-answer-output.schema.json',
      executor: 'model_no_tools',
      dependencies: [],
      task: {
        schemaVersion: 'cortex.learning_os.exam_job_task.v1',
        examId: exam.examId,
        kind: exam.kind,
        release,
        releaseSha256: digest(release),
        promptCommitmentDigest: exam.promptCommitmentDigest,
      },
      timeoutSeconds: 1800,
    };
  });
}

export function buildProofCandidateJobDescriptors({
  campaign,
  proofTasks,
  researchArtifactJob = null,
} = {}) {
  assertCampaignFixtureOnly(campaign);
  if (!Array.isArray(proofTasks) || proofTasks.length !== campaign.proofObligationIds.length) {
    throw new Error('proof task set is incomplete');
  }
  return campaign.proofObligationIds.map((obligationId, index) => {
    const supplied = proofTasks.find((row) => row?.obligationId === obligationId);
    const taskEnvelope = parseProofRecordBytes(supplied?.taskBytes, 'campaign proof task');
    const validation = validateProofTask(taskEnvelope.record);
    const frozen = campaign.proofTemplates[index];
    const trustedTemplateBytes = Buffer.from(supplied?.trustedTemplateBytes || '');
    if (!validation.ok
        || taskEnvelope.record.conceptId !== obligationId
        || frozen?.obligationId !== obligationId
        || taskEnvelope.record.theorem.statementSha256 !== frozen.theoremStatementSha256
        || taskEnvelope.record.theorem.templateSha256 !== sha256Text(trustedTemplateBytes)
        || (frozen.frozenTaskSha256 !== null
          && taskEnvelope.bytesSha256 !== frozen.frozenTaskSha256)
        || (frozen.source !== 'synthetic_digest_binding_fixture'
          && taskEnvelope.record.theorem.templateSha256 !== frozen.frozenTemplateSha256)
        || taskEnvelope.record.taskId !== supplied?.task?.taskId
        || taskEnvelope.record.runIdentity.runId !== frozen.taskIdentity.runId
        || taskEnvelope.record.runIdentity.seed !== frozen.taskIdentity.seed
        || taskEnvelope.record.deployment.sourceCommit !== campaign.deployment.sourceCommit
        || taskEnvelope.record.deployment.sourceTree !== campaign.deployment.sourceTree
        || deploymentBindingDigest(taskEnvelope.record.deployment) !== campaign.deploymentDigest) {
      throw new Error(`invalid campaign proof task: ${obligationId}`);
    }
    const dependentResearchArtifact = campaign.fixtureOnly !== true
      && obligationId === 'formal-proof-research-main-result';
    const researchArtifactSource = dependentResearchArtifact
      ? createResearchArtifactSource({
        dependencyJobId: researchArtifactJob?.jobId,
        candidateSessionId: researchArtifactJob?.sessionId,
        candidatePromptSha256: researchArtifactJob?.prompt
          ? sha256Text(researchArtifactJob.prompt)
          : null,
      })
      : null;
    return {
      jobId: `${campaign.campaignId}.${obligationId}`,
      role: 'proof_candidate',
      sessionId: campaign.roles.proofCandidateSessions[index],
      prompt: proofCandidatePrompt(supplied.taskBytes),
      outputSchema: 'proof-candidate-output.schema.json',
      executor: 'model_no_tools',
      dependencies: dependentResearchArtifact ? [researchArtifactJob.jobId] : [],
      task: createProofCandidateJobTask({
        obligationId,
        taskBytes: supplied.taskBytes,
        trustedTemplateBytes,
        replaySessionId: campaign.roles.proofReplaySessions[index],
        claimSemanticsSha256: frozen.claimSemanticsSha256,
        researchArtifactDigest: supplied?.researchArtifactDigest || null,
        researchArtifactSource,
      }),
      timeoutSeconds: 1200,
    };
  });
}

function proofCandidatePrompt(taskBytes) {
  return [
    'Produce one Lean 4 proof term for the exact trusted task below without tools.',
    'Do not emit imports, directives, declarations, sorry, admit, axioms, paths, processes, or environment access.',
    'Return only JSON matching {"proofTerm":"..."}.',
    `Exact task bytes (base64): ${Buffer.from(taskBytes).toString('base64')}`,
  ].join('\n\n');
}

export function buildResearchJobDescriptor({
  campaign,
  role,
  artifact = null,
  artifactDigest = null,
} = {}) {
  assertCampaignFixtureOnly(campaign);
  if (campaign?.fixtureOnly !== true && ['adversarial_review', 'reproduction'].includes(role)) {
    throw new Error('production research review/reproduction must use authenticated independent review and executable-environment runners, not no-tools model jobs');
  }
  const roleConfig = {
    research_candidate: {
      sessionId: campaign.roles.researchCandidateSession,
      outputSchema: 'research-candidate-output.schema.json',
    },
    adversarial_review: {
      sessionId: campaign.roles.researchReviewerSession,
      outputSchema: 'research-review-output.schema.json',
    },
    reproduction: {
      sessionId: campaign.roles.researchReproducerSession,
      outputSchema: 'research-reproduction-output.schema.json',
    },
  }[role];
  if (!roleConfig) throw new Error('invalid research job role');
  return {
    jobId: `${campaign.campaignId}.${role}`,
    role,
    sessionId: roleConfig.sessionId,
    prompt: researchPrompt({ campaign, role, artifact, artifactDigest }),
    outputSchema: roleConfig.outputSchema,
    executor: 'model_no_tools',
    dependencies: [],
    task: {
      schemaVersion: 'cortex.learning_os.research_model_job_task.v1',
      researchProgramDigest: digest(campaign.researchProgram),
      artifactDigest,
    },
    timeoutSeconds: 1800,
  };
}

function validWorkerExecutionIdentity(campaign, call) {
  if (campaign?.fixtureOnly === true) return true;
  const identity = call?.executionIdentity;
  return exactKeys(identity, [
    'planDigest', 'campaignDigest', 'descriptorSetSha256',
    'productTree', 'runtimeSha256', 'closureSha256',
  ])
    && DIGEST.test(String(identity.planDigest || ''))
    && identity.campaignDigest === digest(campaign)
    && DIGEST.test(String(identity.descriptorSetSha256 || ''))
    && identity.productTree === campaign.deployment?.productTree
    && identity.runtimeSha256 === campaign.deployment?.runtimeSha256
    && identity.closureSha256 === campaign.deployment?.closureSha256;
}

function workerExecution(call, campaign, bindings = {}) {
  const interval = {
    jobDigest: call?.jobDigest,
    notBefore: call?.notBefore,
    startedAt: call?.startedAt,
    completedAt: call?.completedAt,
    expiresAt: call?.expiresAt,
  };
  if (call?.schemaVersion !== 'cortex.learning_os.phd_worker_call.v2'
      || !DIGEST.test(String(call.jobDigest || ''))
      || call.notBefore !== campaign?.frozenAt
      || call.expiresAt !== campaign?.expiresAt
      || !Number.isFinite(Date.parse(String(call.startedAt || '')))
      || !Number.isFinite(Date.parse(String(call.completedAt || '')))
      || new Date(Date.parse(call.startedAt)).toISOString() !== call.startedAt
      || new Date(Date.parse(call.completedAt)).toISOString() !== call.completedAt
      || Date.parse(call.startedAt) < Date.parse(call.notBefore)
      || Date.parse(call.completedAt) < Date.parse(call.startedAt)
      || Date.parse(call.completedAt) > Date.parse(call.expiresAt)
      || call.executionIntervalSha256 !== digest(interval)) {
    throw new Error('worker call evidence is missing or invalid');
  }
  return {
    jobId: call.jobId,
    jobDigest: call.jobDigest,
    provider: call.provider,
    model: call.model,
    thinking: call.thinking,
    sandbox: call.sandbox,
    toolsAllowed: call.toolsAllowed,
    toolsUsed: structuredClone(call.toolsUsed),
    usage: structuredClone(call.usage),
    sessionId: call.plannedSessionId || call.sessionId,
    plannedSessionId: call.plannedSessionId,
    providerRequestId: call.providerRequestId,
    providerSessionId: call.providerSessionId,
    role: call.role,
    exactPromptBytes: call.exactPromptBytes,
    promptSha256: call.promptSha256,
    outputSha256: call.outputSha256,
    notBefore: call.notBefore,
    startedAt: call.startedAt,
    completedAt: call.completedAt,
    expiresAt: call.expiresAt,
    executionIntervalSha256: call.executionIntervalSha256,
    attestation: structuredClone(call.attestation || null),
    executionEvidenceCore: structuredClone(call.executionEvidenceCore || null),
    executionEvidenceSha256: call.executionEvidenceSha256 || null,
    executionIdentity: structuredClone(call.executionIdentity || null),
    rawOutputBase64: bindings.rawOutputBase64,
    rawEventLedgerBase64: bindings.rawEventLedgerBase64,
    rawStderrBase64: bindings.rawStderrBase64,
    ...bindings,
  };
}

function exactHarvestedModelCallMatches(execution, harvestedCall) {
  return isRecord(harvestedCall)
    && canonicalJson(execution?.executionEvidenceCore)
      === canonicalJson(harvestedCall.executionEvidenceCore)
    && execution?.executionEvidenceSha256 === harvestedCall.executionEvidenceSha256
    && canonicalJson(execution?.executionEvidenceCore?.command)
      === canonicalJson(harvestedCall.executionEvidenceCore?.command)
    && canonicalJson(execution?.executionEvidenceCore?.environment?.observed)
      === canonicalJson(harvestedCall.executionEvidenceCore?.environment?.observed);
}

function productionHarvestBindingForWorker({
  campaign,
  qualificationPlan,
  harvestState,
  artifactManifestBytesByJob,
  artifactFileBytesByJob,
  signingSecret,
  harvestObservedAt,
  workerCall,
  expectedJobId,
  workerOutputBytes,
  workerRawEventLedgerBytes = Buffer.alloc(0),
  workerRawStderrBytes = Buffer.alloc(0),
} = {}) {
  // A few low-level unit fixtures exercise the evidence mechanics with deliberately
  // incomplete campaign objects. Every campaign that can reach final verification
  // is a signed PHD_CAMPAIGN_SCHEMA object and must consume the exact harvest here.
  if (campaign?.schemaVersion !== PHD_CAMPAIGN_SCHEMA || campaign?.fixtureOnly === true) {
    return null;
  }
  if (!verifySignature(campaign, signingSecret)) {
    throw new Error('production assembler campaign signature mismatch');
  }
  if (!canonicalTimestamp(harvestObservedAt)) {
    throw new Error('production assembler requires an explicit post-harvest observation timestamp');
  }
  const harvest = verifyQualificationHarvestEvidence({
    plan: qualificationPlan,
    harvestState,
    artifactManifestBytesByJob,
    artifactFileBytesByJob,
    campaign,
    signingSecret,
    now: harvestObservedAt,
    requireArtifactManifests: true,
    requireArtifactFiles: true,
  });
  if (!harvest.ok) {
    throw new Error(`production assembler exact harvest mismatch: ${harvest.errors.join('; ')}`);
  }
  const receipt = harvest.receiptsByJob.get(expectedJobId);
  const manifest = harvest.manifestsByJob.get(expectedJobId);
  const files = harvest.filesByJob.get(expectedJobId);
  const harvestedCall = harvest.modelCallsByJob.get(expectedJobId);
  if (!receipt
      || !manifest
      || !files
      || !exactHarvestedModelCallMatches(workerCall, harvestedCall)
      || workerCall?.jobId !== expectedJobId
      || workerCall?.jobDigest !== receipt.jobDigest
      || workerCall?.promptSha256 !== manifest.promptSha256
      || workerCall?.outputSha256 !== manifest.outputSha256
      || workerCall?.notBefore !== receipt.notBefore
      || workerCall?.startedAt !== receipt.startedAt
      || workerCall?.completedAt !== receipt.completedAt
      || workerCall?.expiresAt !== receipt.expiresAt
      || workerCall?.executionIntervalSha256 !== receipt.executionIntervalSha256
      || canonicalJson(workerCall?.executionIdentity)
        !== canonicalJson(receipt.executionIdentity)
      || !Buffer.from(workerOutputBytes || '').equals(files.get('output.json') || Buffer.alloc(0))
      || !Buffer.from(workerRawEventLedgerBytes || '').equals(
        files.get('raw-events.ndjson') || Buffer.alloc(0),
      )
      || !Buffer.from(workerRawStderrBytes || '').equals(
        files.get('stderr.raw') || Buffer.alloc(0),
      )) {
    throw new Error('production assembler worker is not in the exact signed terminal harvest set');
  }
  return harvest.binding;
}

export function assembleExamAttempt({
  campaign,
  qualificationPlan = null,
  harvestState = null,
  artifactManifestBytesByJob = null,
  artifactFileBytesByJob = null,
  signingSecret = null,
  harvestObservedAt = null,
  examId,
  sealedBank,
  releasedAt,
  modelCall,
  outputBytes,
  rawEventLedgerBytes = Buffer.alloc(0),
  rawStderrBytes = Buffer.alloc(0),
  proctorReceipt = null,
  graderReceipt = null,
} = {}) {
  assertCampaignFixtureOnly(campaign);
  const exam = campaign?.exams?.find((row) => row.examId === examId);
  const release = buildCandidateExamRelease({
    campaign,
    examId,
    sealedBank,
    releasedAt,
  });
  const exactOutputBytes = Buffer.isBuffer(outputBytes) ? outputBytes : Buffer.from(outputBytes || '');
  let output;
  try {
    output = JSON.parse(exactOutputBytes.toString('utf8'));
  } catch {
    throw new Error('cannot assemble non-JSON exam worker output bytes');
  }
  if (!exam || modelCall?.role !== 'exam'
      || !validWorkerExecutionIdentity(campaign, modelCall)
      || (modelCall?.plannedSessionId || modelCall?.sessionId) !== exam.candidateSessionId
      || exactOutputBytes.length < 1
      || modelCall.outputSha256 !== sha256Text(exactOutputBytes)
      || !isRecord(output) || Object.keys(output).join(',') !== 'answers'
      || !Array.isArray(output.answers)) {
    throw new Error('cannot assemble invalid exam worker evidence');
  }
  const qualificationHarvestBinding = productionHarvestBindingForWorker({
    campaign,
    qualificationPlan,
    harvestState,
    artifactManifestBytesByJob,
    artifactFileBytesByJob,
    signingSecret,
    harvestObservedAt,
    workerCall: modelCall,
    expectedJobId: `${campaign.campaignId}.${examId}`,
    workerOutputBytes: exactOutputBytes,
    workerRawEventLedgerBytes: rawEventLedgerBytes,
    workerRawStderrBytes: rawStderrBytes,
  });
  const answerById = new Map(output.answers.map((row) => [row?.itemId, row?.answer]));
  const result = sealedBank.items.map((item) => (
    answerById.has(item.itemId)
      && (campaign.fixtureOnly
        ? verifyGeneratedAnswer({ item, answer: answerById.get(item.itemId) }).passed === true
        : checkAnswer(answerById.get(item.itemId), item.checker).passed === true)
  ));
  const score = result.filter(Boolean).length / sealedBank.items.length;
  const passed = output.answers.length === sealedBank.items.length
    && answerById.size === sealedBank.items.length
    && score >= exam.passThreshold;
  const assembled = {
    examId,
    subjectId: campaign.subjectId,
    promptCommitmentDigest: exam.promptCommitmentDigest,
    promptReleasedAt: releasedAt,
    exactPromptBytes: modelCall.exactPromptBytes,
    promptSha256: modelCall.promptSha256,
    startedAt: modelCall.startedAt,
    completedAt: modelCall.completedAt,
    candidateSessionId: modelCall.plannedSessionId || modelCall.sessionId,
    proctorId: exam.proctorId,
    graderId: exam.graderId,
    provider: modelCall.provider,
    model: modelCall.model,
    thinking: modelCall.thinking,
    toolsAllowed: modelCall.toolsAllowed,
    toolsUsed: structuredClone(modelCall.toolsUsed),
    usage: structuredClone(modelCall.usage),
    outputSha256: modelCall.outputSha256,
    candidateExecution: workerExecution(modelCall, campaign, {
      rawOutputBase64: exactOutputBytes.toString('base64'),
      rawEventLedgerBase64: Buffer.from(rawEventLedgerBytes).toString('base64'),
      rawStderrBase64: Buffer.from(rawStderrBytes).toString('base64'),
    }),
    qualificationHarvestBinding: structuredClone(qualificationHarvestBinding),
    proctorReceipt: structuredClone(proctorReceipt),
    graderReceipt: structuredClone(graderReceipt),
    keyMaterialObserved: false,
    candidateKeyDigestObserved: null,
    promptText: examPrompt(release),
    answers: structuredClone(output.answers),
    claimedScore: score,
    claimedPassed: passed,
  };
  if (campaign.fixtureOnly !== true) {
    const verified = verifyExamAttempt({
      campaign,
      exam,
      bank: sealedBank,
      attempt: assembled,
      harvestedWorkerCall: campaign.schemaVersion === PHD_CAMPAIGN_SCHEMA
        ? modelCall
        : null,
    });
    if (!verified.passed) {
      throw new Error(`cannot assemble unauthenticated or failed production exam evidence: ${verified.errors.join('; ')}`);
    }
  }
  return assembled;
}

export function assembleResearchEvidence({
  campaign,
  candidateOutput,
  candidateCall,
  candidateOutputBytes,
  candidateRawEventLedgerBytes = Buffer.alloc(0),
  candidateRawStderrBytes = Buffer.alloc(0),
  reviewOutput,
  reviewCall,
  reviewOutputBytes,
  reviewRawEventLedgerBytes = Buffer.alloc(0),
  reviewRawStderrBytes = Buffer.alloc(0),
  reproductionOutput,
  reproductionCall,
  reproductionOutputBytes,
  reproductionRawEventLedgerBytes = Buffer.alloc(0),
  reproductionRawStderrBytes = Buffer.alloc(0),
  mainTheoremTemplateSha256,
} = {}) {
  assertCampaignFixtureOnly(campaign);
  const exact = [
    [candidateOutput, candidateOutputBytes, candidateCall, 'candidate'],
    [reviewOutput, reviewOutputBytes, reviewCall, 'review'],
    [reproductionOutput, reproductionOutputBytes, reproductionCall, 'reproduction'],
  ];
  for (const [parsed, bytes, call, label] of exact) {
    const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '');
    let reparsed;
    try { reparsed = JSON.parse(raw.toString('utf8')); } catch {
      throw new Error(`research ${label} raw output is not JSON`);
    }
    if (raw.length < 1 || call?.outputSha256 !== sha256Text(raw)
        || !validWorkerExecutionIdentity(campaign, call)
        || canonicalJson(reparsed) !== canonicalJson(parsed)) {
      throw new Error(`research ${label} output bytes are not bound to the worker call`);
    }
  }
  if (!isRecord(candidateOutput)
      || Object.keys(candidateOutput).sort().join(',') !== 'artifact,novelty,result'
      || !isRecord(candidateOutput.artifact)
      || !isRecord(candidateOutput.novelty)
      || !isRecord(reviewOutput)
      || Object.keys(reviewOutput).sort().join(',') !== 'adversarial,findings,status'
      || !Array.isArray(reviewOutput.findings)
      || !isRecord(reproductionOutput)
      || Object.keys(reproductionOutput).sort().join(',') !== 'fixtureOnly,notes,result,status'
      || reproductionOutput.fixtureOnly !== true) {
    throw new Error('research worker outputs do not match the strict role schemas');
  }
  if (candidateCall?.role !== 'research_candidate'
      || reviewCall?.role !== 'adversarial_review'
      || reproductionCall?.role !== 'reproduction') {
    throw new Error('research worker role collision or substitution');
  }
  const artifactDigest = digest(candidateOutput.artifact);
  const resultDigest = digest(candidateOutput.result);
  const reviewDigest = digest(reviewOutput);
  return {
    candidateSessionId: candidateCall.plannedSessionId || candidateCall.sessionId,
    artifact: structuredClone(candidateOutput.artifact),
    artifactDigest,
    result: structuredClone(candidateOutput.result),
    resultDigest,
    corpusDigest: campaign.researchProgram.corpusDigest,
    environmentDigest: campaign.researchProgram.environmentDigest,
    assumptionsDigest: campaign.researchProgram.assumptionsDigest,
    mainTheoremTemplateSha256,
    candidateExecution: workerExecution(candidateCall, campaign, {
      artifactDigest,
      rawOutputBase64: Buffer.from(candidateOutputBytes).toString('base64'),
      rawEventLedgerBase64: Buffer.from(candidateRawEventLedgerBytes).toString('base64'),
      rawStderrBase64: Buffer.from(candidateRawStderrBytes).toString('base64'),
    }),
    review: {
      sessionId: reviewCall.plannedSessionId || reviewCall.sessionId,
      artifactDigest,
      status: reviewOutput.status,
      adversarial: reviewOutput.adversarial,
      artifact: structuredClone(reviewOutput),
      reviewDigest,
      execution: workerExecution(reviewCall, campaign, {
        artifactDigest,
        reviewDigest,
        rawOutputBase64: Buffer.from(reviewOutputBytes).toString('base64'),
        rawEventLedgerBase64: Buffer.from(reviewRawEventLedgerBytes).toString('base64'),
        rawStderrBase64: Buffer.from(reviewRawStderrBytes).toString('base64'),
      }),
    },
    reproduction: {
      sessionId: reproductionCall.plannedSessionId || reproductionCall.sessionId,
      artifactDigest,
      environmentDigest: campaign.researchProgram.environmentDigest,
      result: structuredClone(reproductionOutput.result),
      resultDigest: digest(reproductionOutput.result),
      status: reproductionOutput.status,
      execution: workerExecution(reproductionCall, campaign, {
        artifactDigest,
        resultDigest: digest(reproductionOutput.result),
        rawOutputBase64: Buffer.from(reproductionOutputBytes).toString('base64'),
        rawEventLedgerBase64: Buffer.from(reproductionRawEventLedgerBytes).toString('base64'),
        rawStderrBase64: Buffer.from(reproductionRawStderrBytes).toString('base64'),
      }),
    },
    novelty: structuredClone(candidateOutput.novelty),
  };
}

export function validateProductionResearchAttestations({
  campaign,
  artifactDigest,
  result,
  resultDigest,
  candidateExecution,
  reproductionBundle,
  reviewAttestation,
  reviewRequestBinding,
  harvestedWorkerCall = null,
} = {}) {
  const errors = [];
  if (campaign?.fixtureOnly !== false) {
    return { ok: false, errors: ['production research attestations require a non-fixture campaign'] };
  }
  let candidatePrompt = null;
  let candidatePromptSha256 = null;
  try {
    candidatePrompt = researchPrompt({
      campaign,
      role: 'research_candidate',
    });
    candidatePromptSha256 = sha256Text(candidatePrompt);
  } catch (error) {
    errors.push(error.message);
  }
  errors.push(...noToolsExecutionErrors(candidateExecution, campaign, {
    sessionId: campaign.roles?.researchCandidateSession,
    promptSha256: candidatePromptSha256,
    promptBytes: candidatePrompt === null ? null : Buffer.from(candidatePrompt, 'utf8'),
    role: 'research_candidate',
    bindings: {
      taskId: null,
      taskSha256: digest({
        schemaVersion: 'cortex.learning_os.research_model_job_task.v1',
        researchProgramDigest: digest(campaign.researchProgram),
        artifactDigest: null,
      }),
      jobId: `${campaign.campaignId}.research_candidate`,
    },
    harvestedWorkerCall,
  }));
  const candidatePayload = executionEvidencePayload(candidateExecution?.attestation);
  const candidateAttestationSha256 = executionAttestationDigest(candidateExecution);
  const approvedResearchRuntime = campaign?.deployment?.approvedResearchRuntime;
  const approvedResearchRuntimeValidation = validateApprovedResearchRuntimeBinding(
    approvedResearchRuntime,
    { observe: false },
  );
  const approvedResearchRuntimeSha256 = approvedResearchRuntimeValidation.ok
    ? digest(approvedResearchRuntime)
    : null;
  errors.push(...approvedResearchRuntimeValidation.errors.map(
    (error) => `approved research runtime: ${error}`,
  ));
  if (!DIGEST.test(String(artifactDigest || ''))
      || !DIGEST.test(String(resultDigest || ''))
      || resultDigest !== digest(result)
      || !DIGEST.test(String(candidateAttestationSha256 || ''))) {
    errors.push('production research candidate artifact, result, or execution identity is invalid');
  }

  const bundleKeys = [
    'schemaVersion',
    'fixtureOnly',
    'status',
    'exitCode',
    'sourceBundleBase64',
    'sourceBundleSha256',
    'environment',
    'environmentDigest',
    'command',
    'commandDigest',
    'approvedResearchRuntimeSha256',
    'daemonClosureSha256',
    'observedEnvironmentSha256',
    'executedArgvSha256',
    'executableSha256',
    'isolationSha256',
    'stdoutBase64',
    'stdoutSha256',
    'stderrBase64',
    'stderrSha256',
    'outputs',
    'resultOutputPath',
    'resultBase64',
    'resultSha256',
    'result',
    'resultDigest',
    'startedAt',
    'completedAt',
    'executionEvidenceCore',
    'executionEvidenceSha256',
    'authorityRequestBytesBase64',
    'authorityRequestSha256',
    'attestation',
  ];
  if (!exactKeys(reproductionBundle, bundleKeys)
      || reproductionBundle.schemaVersion !== RESEARCH_REPRODUCTION_BUNDLE_SCHEMA
      || reproductionBundle.fixtureOnly !== false
      || reproductionBundle.status !== 'passed'
      || reproductionBundle.exitCode !== 0) {
    errors.push('research reproduction schema identity or passed process outcome is invalid');
  }
  const sourceBytes = exactBase64Bytes(reproductionBundle?.sourceBundleBase64);
  const stdoutBytes = exactBase64Bytes(reproductionBundle?.stdoutBase64, { allowEmpty: true });
  const stderrBytes = exactBase64Bytes(reproductionBundle?.stderrBase64, { allowEmpty: true });
  const resultBytes = exactBase64Bytes(reproductionBundle?.resultBase64);
  const authorityRequestBytes = exactBase64Bytes(
    reproductionBundle?.authorityRequestBytesBase64,
  );
  let authorityRequest = null;
  try {
    authorityRequest = JSON.parse(authorityRequestBytes?.toString('utf8') || '');
  } catch {
    errors.push('research reproduction exact authority request bytes are not JSON');
  }
  if (!authorityRequestBytes
      || reproductionBundle?.authorityRequestSha256 !== sha256Bytes(authorityRequestBytes)
      || !authorityRequest
      || !serializeResearchReproductionAuthorityRequest(authorityRequest)
        .equals(authorityRequestBytes)) {
    errors.push('research reproduction authority request bytes, digest, or encoding are invalid');
  }
  if (authorityRequest !== null) {
    const requestSchemaValidation = validateJsonSchema(
      authorityRequest,
      path.join(CLOS_ROOT, 'schemas/research-reproduction-authority-request.schema.json'),
    );
    errors.push(...requestSchemaValidation.errors.map(
      (error) => `research reproduction authority request schema: ${error}`,
    ));
  }
  const executionEvidenceValidation = validateExecutionEvidenceRecord({
    core: reproductionBundle?.executionEvidenceCore,
    executionEvidenceSha256: reproductionBundle?.executionEvidenceSha256,
  });
  errors.push(...executionEvidenceValidation.errors);
  let parsedResult = null;
  try {
    parsedResult = JSON.parse(resultBytes?.toString('utf8') || '');
  } catch {
    errors.push('research reproduction exact result bytes are not JSON');
  }
  if (!sourceBytes
      || reproductionBundle?.sourceBundleSha256 !== sha256Bytes(sourceBytes)
      || reproductionBundle?.sourceBundleSha256 !== campaign.researchProgram?.sourceBundleSha256
      || !isRecord(reproductionBundle?.environment)
      || canonicalJson(reproductionBundle.environment)
        !== canonicalJson(campaign.researchProgram?.environment)
      || reproductionBundle?.environmentDigest !== digest(reproductionBundle?.environment)
      || reproductionBundle?.environmentDigest !== campaign.researchProgram?.environmentDigest
      || reproductionBundle?.approvedResearchRuntimeSha256
        !== approvedResearchRuntimeSha256
      || reproductionBundle?.daemonClosureSha256
        !== approvedResearchRuntime?.daemonClosureSha256
      || !Array.isArray(reproductionBundle?.command)
      || canonicalJson(reproductionBundle.command)
        !== canonicalJson(campaign.researchProgram?.reproduction?.command)
      || reproductionBundle?.commandDigest !== digest(reproductionBundle?.command)
      || !stdoutBytes || reproductionBundle?.stdoutSha256 !== sha256Bytes(stdoutBytes)
      || !stderrBytes || reproductionBundle?.stderrSha256 !== sha256Bytes(stderrBytes)
      || !resultBytes || reproductionBundle?.resultSha256 !== sha256Bytes(resultBytes)
      || canonicalJson(parsedResult) !== canonicalJson(result)
      || canonicalJson(reproductionBundle?.result) !== canonicalJson(result)
      || reproductionBundle?.resultDigest !== digest(reproductionBundle?.result)
      || reproductionBundle?.resultDigest !== resultDigest) {
    errors.push('research reproduction source, command, environment, logs, or exact result bytes are incomplete');
  }

  const expectedOutputPaths = campaign.researchProgram?.reproduction?.outputPaths;
  const outputPaths = new Set();
  const exactOutputFiles = {};
  let resultOutput = null;
  if (!Array.isArray(reproductionBundle?.outputs)
      || !Array.isArray(expectedOutputPaths)
      || reproductionBundle.outputs.length !== expectedOutputPaths.length) {
    errors.push('research reproduction output set is incomplete');
  } else {
    for (const [index, output] of reproductionBundle.outputs.entries()) {
      const content = exactBase64Bytes(output?.contentBase64, { allowEmpty: true });
      if (!exactKeys(output, ['bytes', 'path', 'contentBase64', 'sha256'])
          || output.path !== expectedOutputPaths[index]
          || outputPaths.has(output.path)
          || !content || output.bytes !== content.length
          || output.sha256 !== sha256Bytes(content)) {
        errors.push(`research reproduction output bytes are invalid: ${String(output?.path || index)}`);
      }
      outputPaths.add(output?.path);
      if (content) exactOutputFiles[output.path] = content;
      if (output?.path === reproductionBundle?.resultOutputPath) resultOutput = output;
    }
  }
  if (typeof reproductionBundle?.resultOutputPath !== 'string'
      || !outputPaths.has(reproductionBundle.resultOutputPath)
      || resultOutput?.contentBase64 !== reproductionBundle?.resultBase64
      || resultOutput?.sha256 !== reproductionBundle?.resultSha256) {
    errors.push('research reproduction output/result correspondence is invalid');
  }
  if (executionEvidenceValidation.ok) {
    const bytesValidation = verifyExecutionEvidenceBytes(
      reproductionBundle.executionEvidenceCore,
      {
        inputBytes: sourceBytes,
        rawOutputs: {
          stdout: stdoutBytes,
          stderr: stderrBytes,
        },
        outputFiles: exactOutputFiles,
      },
    );
    errors.push(...bytesValidation.errors);
    const core = reproductionBundle.executionEvidenceCore;
    const endpointArguments = approvedResearchRuntime?.kind === 'docker'
      ? ['--host', `unix://${approvedResearchRuntime?.daemonClosure?.socketPath}`]
      : ['--url', `unix://${approvedResearchRuntime?.daemonClosure?.socketPath}`];
    const containerIdPath = path.join(path.dirname(core.command?.cwd || '/'), 'container.cid');
    const expectedRequestedArgv = [
      approvedResearchRuntime?.path,
      ...endpointArguments,
      'run',
      '--cidfile', containerIdPath,
      '--runtime',
      approvedResearchRuntime?.daemonClosure?.derivedTopology?.defaultRuntimeName,
      '--network=none',
      '--read-only',
      '--security-opt=no-new-privileges',
      '--security-opt=apparmor=docker-default',
      `--security-opt=seccomp=${
        approvedResearchRuntime?.daemonClosure?.derivedTopology?.seccompProfilePath
      }`,
      '--log-driver=none',
      '--cap-drop=ALL',
      '--pids-limit=256',
      '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m',
      '--volume', `${core.command?.cwd}:/workspace:rw`,
      '--workdir', '/workspace',
      campaign.researchProgram?.environment?.imageReference,
      ...campaign.researchProgram.reproduction.command,
    ];
    const expectedExecutedArgv = [
      '/proc/self/fd/4',
      ...expectedRequestedArgv.slice(1),
    ];
    const expectedIsolation = {
      network: 'none',
      rootFilesystem: 'read_only',
      noNewPrivileges: true,
      capabilities: 'none',
      pidLimit: 256,
      temporaryFilesystem: 'rw_noexec_nosuid_nodev_64m',
      workspaceMount: 'rw',
    };
    const observed = core.environment?.observed;
    const imageInspectBytes = exactBase64Bytes(observed?.imageInspectBase64);
    const containerInspectBytes = exactBase64Bytes(observed?.containerInspectBase64);
    let rawImageInspect = null;
    let rawContainerInspect = null;
    try {
      rawImageInspect = JSON.parse(imageInspectBytes?.toString('utf8') || '');
      rawContainerInspect = JSON.parse(containerInspectBytes?.toString('utf8') || '');
      if (Array.isArray(rawImageInspect) && rawImageInspect.length === 1) {
        [rawImageInspect] = rawImageInspect;
      }
      if (Array.isArray(rawContainerInspect) && rawContainerInspect.length === 1) {
        [rawContainerInspect] = rawContainerInspect;
      }
    } catch {
      rawImageInspect = null;
      rawContainerInspect = null;
    }
    const effectiveIsolation = observed?.effectiveIsolation;
    const kernelValidation = validateResearchKernelEvidence(observed?.kernelEvidence, {
      containerId: effectiveIsolation?.containerId,
      workspace: core.command?.cwd,
      expectedCommand: campaign.researchProgram?.reproduction?.command?.[0],
      expectedLsmProfile: 'docker-default',
      expectedLsmPolicy: approvedResearchRuntime?.daemonClosure?.securityProfiles?.find(
        (profile) => profile.kind === 'apparmor',
      ),
      expectedShimSha256: approvedResearchRuntime?.daemonClosure?.runtimeHelpers?.find(
        (helper) => helper.path
          === approvedResearchRuntime?.daemonClosure?.derivedTopology?.shimPath,
      )?.sha256,
    });
    const expectedRuntimeCommands = {
      imageInspect: [
        approvedResearchRuntime?.path,
        ...endpointArguments,
        'image', 'inspect', '--format', '{{json .}}',
        campaign.researchProgram.environment.imageReference,
      ],
      run: expectedRequestedArgv,
      containerInspect: [
        approvedResearchRuntime?.path,
        ...endpointArguments,
        'container', 'inspect', '--format', '{{json .}}',
        effectiveIsolation?.containerId,
      ],
      remove: [
        approvedResearchRuntime?.path,
        ...endpointArguments,
        'rm', '--force', effectiveIsolation?.containerId,
      ],
    };
    const rawMounts = rawContainerInspect?.Mounts;
    const matchingRawMounts = Array.isArray(rawMounts)
      ? rawMounts.filter((entry) => (
        entry?.Type === 'bind'
        && entry.Source === core.command?.cwd
        && entry.Destination === '/workspace'
        && entry.RW === true
      ))
      : [];
    const rawSecurityOpt = rawContainerInspect?.HostConfig?.SecurityOpt;
    if (core.executionKind !== 'process'
        || core.bindings.candidateSha256 !== candidatePayload?.outputSha256
        || core.bindings.candidateSessionId !== campaign.roles?.researchCandidateSession
        || core.bindings.campaignId !== campaign.campaignId
        || core.bindings.campaignSha256 !== digest(campaign)
        || core.bindings.deploymentSha256 !== campaign.deploymentDigest
        || core.bindings.sourceSha256 !== reproductionBundle.sourceBundleSha256
        || core.bindings.taskId !== null
        || core.bindings.taskSha256 !== digest({
          schemaVersion: RESEARCH_REPRODUCTION_TASK_SCHEMA,
          campaignId: campaign.campaignId,
          candidateJobId: `${campaign.campaignId}.research_candidate`,
          candidateSessionId: campaign.roles.researchCandidateSession,
          candidatePromptSha256: sha256Text(researchPrompt({
            campaign,
            role: 'research_candidate',
          })),
          fixtureOnly: false,
          approvedResearchRuntime: campaign.deployment.approvedResearchRuntime,
          approvedResearchRuntimeSha256: digest(
            campaign.deployment.approvedResearchRuntime,
          ),
          sourceBundle: campaign.researchProgram.sourceBundle,
          sourceBundleSha256: campaign.researchProgram.sourceBundleSha256,
          environment: campaign.researchProgram.environment,
          environmentDigest: campaign.researchProgram.environmentDigest,
          command: campaign.researchProgram.reproduction.command,
          commandDigest: digest(campaign.researchProgram.reproduction.command),
          outputPaths: campaign.researchProgram.reproduction.outputPaths,
          resultPath: campaign.researchProgram.reproduction.resultPath,
          timeoutSeconds: campaign.researchProgram.reproduction.timeoutSeconds || 1800,
        })
        || core.bindings.jobId !== `${campaign.campaignId}.research-reproduction`
        || core.environment.declaredSha256 !== reproductionBundle.environmentDigest
        || canonicalJson(core.environment.declared)
          !== canonicalJson(reproductionBundle.environment)
        || canonicalJson(core.command.requestedArgv)
          !== canonicalJson(expectedRequestedArgv)
        || canonicalJson(core.command.executedArgv)
          !== canonicalJson(expectedExecutedArgv)
        || canonicalJson(core.command.executable) !== canonicalJson({
          invoked: approvedResearchRuntime?.path,
          resolvedPath: '/proc/self/fd/4',
          bytes: approvedResearchRuntime?.bytes,
          sha256: approvedResearchRuntime?.sha256,
        })
        || !exactKeys(observed, [
          'approvedResearchRuntimeSha256',
          'containerRuntime',
          'containerInspectBase64',
          'containerInspectSha256',
          'daemonClosureSha256',
          'daemonMeasurements',
          'daemonObservation',
          'daemonSocketPath',
          'executionKind',
          'effectiveIsolation',
          'imageDigest',
          'imageId',
          'imageInspectBase64',
          'imageInspectSha256',
          'imageReference',
          'imageRepoDigests',
          'isolation',
          'kernelEvidence',
          'processEnvironment',
          'runtimeClosureSha256',
          'runtimeCommands',
          'runtimeLockDigest',
        ])
        || observed.executionKind !== 'container'
        || observed.containerRuntime !== approvedResearchRuntime?.kind
        || observed.approvedResearchRuntimeSha256 !== approvedResearchRuntimeSha256
        || observed.runtimeClosureSha256 !== approvedResearchRuntime?.runtimeClosureSha256
        || observed.daemonClosureSha256 !== approvedResearchRuntime?.daemonClosureSha256
        || !validateApprovedResearchDaemonObservation(
          observed.daemonObservation,
          approvedResearchRuntime,
        ).ok
        || observed.daemonSocketPath !== approvedResearchRuntime?.daemonClosure?.socketPath
        || !Array.isArray(observed.daemonMeasurements)
        || canonicalJson(observed.daemonMeasurements.map((row) => row?.phase))
          !== canonicalJson([
            'before_image_inspect', 'after_image_inspect', 'before_run', 'after_run',
            'after_cleanup',
          ])
        || observed.daemonMeasurements.some((row) => (
          canonicalJson(row) !== canonicalJson(expectedResearchDaemonMeasurement(
            row?.phase,
            observed.daemonObservation,
          ))
        ))
        || observed.imageReference !== campaign.researchProgram.environment.imageReference
        || observed.imageDigest !== campaign.researchProgram.environment.imageDigest
        || observed.imageId !== campaign.researchProgram.environment.imageId
        || canonicalJson(observed.imageRepoDigests)
          !== canonicalJson([campaign.researchProgram.environment.imageReference])
        || imageInspectBytes === null
        || observed.imageInspectSha256 !== sha256Bytes(imageInspectBytes)
        || rawImageInspect?.Id !== observed.imageId
        || canonicalJson([...(rawImageInspect?.RepoDigests || [])].sort())
          !== canonicalJson(observed.imageRepoDigests)
        || containerInspectBytes === null
        || observed.containerInspectSha256 !== sha256Bytes(containerInspectBytes)
        || !/^[0-9a-f]{64}$/.test(String(effectiveIsolation?.containerId || ''))
        || rawContainerInspect?.Id !== effectiveIsolation.containerId
        || rawContainerInspect?.Image !== campaign.researchProgram.environment.imageId
        || rawContainerInspect?.HostConfig?.NetworkMode !== 'none'
        || rawContainerInspect?.HostConfig?.ReadonlyRootfs !== true
        || rawContainerInspect?.HostConfig?.Privileged !== false
        || rawContainerInspect?.HostConfig?.PidsLimit !== 256
        || rawContainerInspect?.HostConfig?.Runtime
          !== approvedResearchRuntime?.daemonClosure?.derivedTopology?.defaultRuntimeName
        || canonicalJson(rawContainerInspect?.HostConfig?.LogConfig)
          !== canonicalJson({ Type: 'none', Config: {} })
        || canonicalJson([...(rawContainerInspect?.HostConfig?.CapDrop || [])].sort())
          !== canonicalJson(['ALL'])
        || (rawContainerInspect?.HostConfig?.CapAdd || []).length !== 0
        || (rawContainerInspect?.HostConfig?.Devices || []).length !== 0
        || !Array.isArray(rawSecurityOpt)
        || canonicalJson([...rawSecurityOpt].sort()) !== canonicalJson([
          'apparmor=docker-default',
          'no-new-privileges',
          `seccomp=${
            approvedResearchRuntime?.daemonClosure?.derivedTopology?.seccompProfilePath
          }`,
        ].sort())
        || rawContainerInspect?.HostConfig?.Tmpfs?.['/tmp']
          !== 'rw,noexec,nosuid,nodev,size=64m'
        || matchingRawMounts.length !== 1
        || rawContainerInspect?.Config?.WorkingDir !== '/workspace'
        || canonicalJson(effectiveIsolation) !== canonicalJson({
          containerId: effectiveIsolation?.containerId,
          imageId: campaign.researchProgram.environment.imageId,
          network: 'none',
          rootFilesystem: 'read_only',
          noNewPrivileges: true,
          privileged: false,
          capabilities: 'none',
          addedCapabilities: 'none',
          devices: 'none',
          pidLimit: 256,
          temporaryFilesystem: 'rw_noexec_nosuid_nodev_64m',
          workspaceMount: {
            type: 'bind',
            source: core.command?.cwd,
            destination: '/workspace',
            readWrite: true,
          },
          workingDirectory: '/workspace',
        })
        || canonicalJson(observed.runtimeCommands)
          !== canonicalJson(expectedRuntimeCommands)
        || observed.runtimeLockDigest !== campaign.researchProgram.environment.lockDigest
        || canonicalJson(observed.processEnvironment) !== canonicalJson({
          LANG: 'C',
          LC_ALL: 'C',
        })
        || canonicalJson(observed.isolation) !== canonicalJson(expectedIsolation)
        || !kernelValidation.ok
        || reproductionBundle.observedEnvironmentSha256 !== digest(observed)
        || reproductionBundle.executedArgvSha256 !== digest(expectedExecutedArgv)
        || reproductionBundle.executableSha256 !== approvedResearchRuntime?.sha256
        || reproductionBundle.isolationSha256 !== digest(expectedIsolation)
        || core.process.startedAt !== reproductionBundle.startedAt
        || core.process.completedAt !== reproductionBundle.completedAt
        || core.process.exitCode !== reproductionBundle.exitCode
        || core.process.signal !== null
        || core.process.error !== null) {
      errors.push('research reproduction canonical execution-evidence binding mismatch');
      errors.push(...kernelValidation.errors.map(
        (error) => `research reproduction kernel evidence: ${error}`,
      ));
    }
  }

  errors.push(...authenticatedIntervalErrors({
    startedAt: reproductionBundle?.startedAt,
    completedAt: reproductionBundle?.completedAt,
    notBefore: campaign.frozenAt,
    notAfter: campaign.expiresAt,
    minimumStartedAt: candidatePayload?.completedAt,
    label: 'research reproduction',
  }));
  const reproductionPayload = {
    schemaVersion: RESEARCH_REPRODUCTION_BUNDLE_SCHEMA,
    fixtureOnly: false,
    campaignId: campaign.campaignId,
    artifactDigest,
    sourceBundleSha256: reproductionBundle?.sourceBundleSha256 ?? null,
    environmentDigest: reproductionBundle?.environmentDigest ?? null,
    commandDigest: reproductionBundle?.commandDigest ?? null,
    approvedResearchRuntimeSha256: reproductionBundle?.approvedResearchRuntimeSha256 ?? null,
    daemonClosureSha256: reproductionBundle?.daemonClosureSha256 ?? null,
    observedEnvironmentSha256: reproductionBundle?.observedEnvironmentSha256 ?? null,
    executedArgvSha256: reproductionBundle?.executedArgvSha256 ?? null,
    executableSha256: reproductionBundle?.executableSha256 ?? null,
    isolationSha256: reproductionBundle?.isolationSha256 ?? null,
    stdoutSha256: reproductionBundle?.stdoutSha256 ?? null,
    stderrSha256: reproductionBundle?.stderrSha256 ?? null,
    outputsDigest: Array.isArray(reproductionBundle?.outputs)
      ? digest(reproductionBundle.outputs)
      : null,
    resultOutputPath: reproductionBundle?.resultOutputPath ?? null,
    resultSha256: reproductionBundle?.resultSha256 ?? null,
    resultDigest,
    status: 'passed',
    exitCode: 0,
    startedAt: reproductionBundle?.startedAt ?? null,
    completedAt: reproductionBundle?.completedAt ?? null,
    executionEvidenceCore: reproductionBundle?.executionEvidenceCore ?? null,
    executionEvidenceSha256: reproductionBundle?.executionEvidenceSha256 ?? null,
  };
  const requestedPayloadBytes = Buffer.from(canonicalJson(reproductionPayload), 'utf8');
  const requestedCandidateArtifactDigest = isRecord(
    authorityRequest?.candidateBinding?.artifact,
  )
    ? digest(authorityRequest.candidateBinding.artifact)
    : null;
  const requestedCandidateResultDigest = isRecord(authorityRequest?.candidateBinding)
      && Object.hasOwn(authorityRequest.candidateBinding, 'result')
    ? digest(authorityRequest.candidateBinding.result)
    : null;
  if (authorityRequest?.schemaVersion !== RESEARCH_REPRODUCTION_REQUEST_SCHEMA
      || authorityRequest?.requestedCapability !== 'research_reproduction'
      || authorityRequest?.unsigned !== true
      || authorityRequest?.selfAttestation !== false
      || authorityRequest?.status !== 'ready_for_independent_authority'
      || authorityRequest?.authorityAttestation !== null
      || authorityRequest?.approvedResearchRuntimeSha256 !== approvedResearchRuntimeSha256
      || !canonicalEqual(authorityRequest?.approvedResearchRuntime, approvedResearchRuntime)
      || authorityRequest?.candidateBinding?.jobId
        !== `${campaign.campaignId}.research_candidate`
      || authorityRequest?.candidateBinding?.artifactDigest !== artifactDigest
      || requestedCandidateArtifactDigest !== artifactDigest
      || authorityRequest?.candidateBinding?.resultDigest !== resultDigest
      || !canonicalEqual(authorityRequest?.candidateBinding?.result, result)
      || requestedCandidateResultDigest !== resultDigest
      || authorityRequest?.candidateBinding?.outputSha256 !== candidatePayload?.outputSha256
      || authorityRequest?.candidateBinding?.candidateSessionId
        !== campaign.roles?.researchCandidateSession
      || authorityRequest?.candidateBinding?.harvestedAuthority
        !== 'worker_evidence_only'
      || !canonicalEqual(authorityRequest?.declaredEnvironment, reproductionBundle?.environment)
      || !canonicalEqual(
        authorityRequest?.observedEnvironment,
        reproductionBundle?.executionEvidenceCore?.environment?.observed,
      )
      || authorityRequest?.sourceBundleSha256 !== reproductionBundle?.sourceBundleSha256
      || !canonicalEqual(authorityRequest?.command, reproductionBundle?.command)
      || !canonicalEqual(
        authorityRequest?.executedCommand,
        reproductionBundle?.executionEvidenceCore?.command?.executedArgv,
      )
      || authorityRequest?.commandDigest !== reproductionBundle?.commandDigest
      || authorityRequest?.startedAt !== reproductionBundle?.startedAt
      || authorityRequest?.completedAt !== reproductionBundle?.completedAt
      || authorityRequest?.process?.exitCode !== reproductionBundle?.exitCode
      || authorityRequest?.process?.signal !== null
      || authorityRequest?.process?.error !== null
      || authorityRequest?.logs?.stdoutSha256 !== reproductionBundle?.stdoutSha256
      || authorityRequest?.logs?.stderrSha256 !== reproductionBundle?.stderrSha256
      || !canonicalEqual(authorityRequest?.outputs, reproductionBundle?.outputs)
      || authorityRequest?.resultPath !== reproductionBundle?.resultOutputPath
      || !canonicalEqual(authorityRequest?.result, reproductionBundle?.result)
      || authorityRequest?.recomputedResultDigest !== reproductionBundle?.resultDigest
      || authorityRequest?.expectedResultDigest !== reproductionBundle?.resultDigest
      || authorityRequest?.outputError !== null
      || !canonicalEqual(
        authorityRequest?.executionEvidenceCore,
        reproductionBundle?.executionEvidenceCore,
      )
      || authorityRequest?.executionEvidenceSha256
        !== reproductionBundle?.executionEvidenceSha256
      || !canonicalEqual(authorityRequest?.requestedAttestationPayload, reproductionPayload)
      || exactBase64Bytes(
        authorityRequest?.requestedAttestationPayloadBytesBase64,
      )?.equals(requestedPayloadBytes) !== true
      || authorityRequest?.requestedAttestationPayloadSha256
        !== sha256Bytes(requestedPayloadBytes)) {
    errors.push('research reproduction authority request does not bind the exact final payload bytes');
  }
  const authorityPayload = {
    schemaVersion: 'cortex.learning_os.research_reproduction_authority_payload.v2',
    requestSha256: reproductionBundle?.authorityRequestSha256,
    reproductionPayload,
    authorityMeasurement: reproductionBundle?.attestation?.payload?.authorityMeasurement,
  };
  const authorityMeasurement = authorityPayload.authorityMeasurement;
  const authorityResearchRuntime = authorityMeasurement?.authorityResearchRuntime;
  const authorityResearchRuntimeValidation = validateApprovedResearchRuntimeBinding(
    authorityResearchRuntime,
    { observe: false },
  );
  const authorityResearchRuntimeSha256 = authorityResearchRuntimeValidation.ok
    ? digest(authorityResearchRuntime)
    : null;
  const independentAuthoritySubstrate = authorityResearchRuntimeValidation.ok
    && authorityResearchRuntimeSha256 !== approvedResearchRuntimeSha256
    && authorityResearchRuntime?.daemonClosureSha256
      !== approvedResearchRuntime?.daemonClosureSha256
    && authorityResearchRuntime?.daemonClosure?.serviceManager?.mainPid
      !== approvedResearchRuntime?.daemonClosure?.serviceManager?.mainPid
    && authorityResearchRuntime?.daemonClosure?.serviceManager?.invocationId
      !== approvedResearchRuntime?.daemonClosure?.serviceManager?.invocationId
    && authorityResearchRuntime?.daemonClosure?.process?.startTimeTicks
      !== approvedResearchRuntime?.daemonClosure?.process?.startTimeTicks
    && authorityResearchRuntime?.daemonClosure?.process?.socketInode
      !== approvedResearchRuntime?.daemonClosure?.process?.socketInode;
  const authorityReplayCore = authorityMeasurement?.replayExecutionEvidenceCore;
  const authorityReplayValidation = validateExecutionEvidenceCore(authorityReplayCore);
  const authorityReplayOutputFiles = authorityReplayCore?.outputs?.files;
  const authorityReplayObserved = authorityReplayCore?.environment?.observed;
  const authorityReplayEffective = authorityReplayObserved?.effectiveIsolation;
  const authorityKernelValidation = validateResearchKernelEvidence(
    authorityReplayObserved?.kernelEvidence,
    {
      containerId: authorityReplayEffective?.containerId,
      workspace: authorityReplayCore?.command?.cwd,
      expectedCommand: campaign.researchProgram?.reproduction?.command?.[0],
      expectedLsmProfile: 'docker-default',
      expectedLsmPolicy: authorityResearchRuntime?.daemonClosure?.securityProfiles?.find(
        (profile) => profile.kind === 'apparmor',
      ),
      expectedShimSha256: authorityResearchRuntime?.daemonClosure?.runtimeHelpers?.find(
        (helper) => helper.path
          === authorityResearchRuntime?.daemonClosure?.derivedTopology?.shimPath,
      )?.sha256,
    },
  );
  const authorityEndpointArguments = authorityResearchRuntime?.kind === 'docker'
    ? ['--host', `unix://${authorityResearchRuntime?.daemonClosure?.socketPath}`]
    : ['--url', `unix://${authorityResearchRuntime?.daemonClosure?.socketPath}`];
  const authorityReplayCwd = authorityReplayCore?.command?.cwd;
  const authorityReplayCidPath = path.join(
    path.dirname(authorityReplayCwd || '/'),
    'container.cid',
  );
  const authorityExpectedRun = [
    authorityResearchRuntime?.path,
    ...authorityEndpointArguments,
    'run',
    '--cidfile', authorityReplayCidPath,
    '--runtime',
    authorityResearchRuntime?.daemonClosure?.derivedTopology?.defaultRuntimeName,
    '--network=none',
    '--read-only',
    '--security-opt=no-new-privileges',
    '--security-opt=apparmor=docker-default',
    `--security-opt=seccomp=${
      authorityResearchRuntime?.daemonClosure?.derivedTopology?.seccompProfilePath
    }`,
    '--log-driver=none',
    '--cap-drop=ALL',
    '--pids-limit=256',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m',
    '--volume', `${authorityReplayCwd}:/workspace:rw`,
    '--workdir', '/workspace',
    campaign.researchProgram.environment.imageReference,
    ...campaign.researchProgram.reproduction.command,
  ];
  const authorityExpectedCommands = {
    imageInspect: [
      authorityResearchRuntime?.path,
      ...authorityEndpointArguments,
      'image', 'inspect', '--format', '{{json .}}',
      campaign.researchProgram.environment.imageReference,
    ],
    run: authorityExpectedRun,
    containerInspect: [
      authorityResearchRuntime?.path,
      ...authorityEndpointArguments,
      'container', 'inspect', '--format', '{{json .}}',
      authorityReplayEffective?.containerId,
    ],
    remove: [
      authorityResearchRuntime?.path,
      ...authorityEndpointArguments,
      'rm', '--force', authorityReplayEffective?.containerId,
    ],
  };
  const authorityImageInspectBytes = exactBase64Bytes(
    authorityReplayObserved?.imageInspectBase64,
  );
  const authorityContainerInspectBytes = exactBase64Bytes(
    authorityReplayObserved?.containerInspectBase64,
  );
  let authorityRawImage = null;
  let authorityRawContainer = null;
  try {
    authorityRawImage = JSON.parse(authorityImageInspectBytes?.toString('utf8') || '');
    authorityRawContainer = JSON.parse(
      authorityContainerInspectBytes?.toString('utf8') || '',
    );
    if (Array.isArray(authorityRawImage) && authorityRawImage.length === 1) {
      [authorityRawImage] = authorityRawImage;
    }
    if (Array.isArray(authorityRawContainer) && authorityRawContainer.length === 1) {
      [authorityRawContainer] = authorityRawContainer;
    }
  } catch {
    authorityRawImage = null;
    authorityRawContainer = null;
  }
  const authorityRawMounts = Array.isArray(authorityRawContainer?.Mounts)
    ? authorityRawContainer.Mounts.filter((entry) => (
      entry?.Type === 'bind'
      && entry.Source === authorityReplayCwd
      && entry.Destination === '/workspace'
      && entry.RW === true
    ))
    : [];
  const authoritySecurityOpt = authorityRawContainer?.HostConfig?.SecurityOpt;
  const authorityObservedValid = exactKeys(authorityReplayObserved, [
    'approvedResearchRuntimeSha256', 'containerInspectBase64',
    'containerInspectSha256', 'containerRuntime', 'daemonClosureSha256',
    'daemonMeasurements', 'daemonObservation', 'daemonSocketPath', 'effectiveIsolation',
    'executionKind', 'imageDigest', 'imageId', 'imageInspectBase64',
    'imageInspectSha256', 'imageReference', 'imageRepoDigests', 'isolation',
    'kernelEvidence', 'processEnvironment', 'runtimeClosureSha256', 'runtimeCommands',
    'runtimeLockDigest',
  ])
    && authorityReplayObserved.executionKind === 'container'
    && authorityReplayObserved.containerRuntime === authorityResearchRuntime?.kind
    && authorityReplayObserved.approvedResearchRuntimeSha256
      === authorityResearchRuntimeSha256
    && authorityReplayObserved.runtimeClosureSha256
      === authorityResearchRuntime?.runtimeClosureSha256
    && authorityReplayObserved.daemonClosureSha256
      === authorityResearchRuntime?.daemonClosureSha256
    && validateApprovedResearchDaemonObservation(
      authorityReplayObserved.daemonObservation,
      authorityResearchRuntime,
    ).ok
    && authorityReplayObserved.daemonSocketPath
      === authorityResearchRuntime?.daemonClosure?.socketPath
    && canonicalJson(authorityReplayObserved.daemonMeasurements)
      === canonicalJson(authorityMeasurement?.daemonMeasurements)
    && authorityReplayObserved.daemonMeasurements.every((row) => (
      canonicalJson(row) === canonicalJson(expectedResearchDaemonMeasurement(
        row?.phase,
        authorityReplayObserved.daemonObservation,
      ))
    ))
    && authorityReplayObserved.imageReference
      === campaign.researchProgram.environment.imageReference
    && authorityReplayObserved.imageDigest
      === campaign.researchProgram.environment.imageDigest
    && authorityReplayObserved.imageId === campaign.researchProgram.environment.imageId
    && canonicalJson(authorityReplayObserved.imageRepoDigests)
      === canonicalJson([campaign.researchProgram.environment.imageReference])
    && authorityImageInspectBytes !== null
    && authorityReplayObserved.imageInspectSha256
      === sha256Bytes(authorityImageInspectBytes)
    && authorityRawImage?.Id === authorityReplayObserved.imageId
    && canonicalJson([...(authorityRawImage?.RepoDigests || [])].sort())
      === canonicalJson(authorityReplayObserved.imageRepoDigests)
    && authorityContainerInspectBytes !== null
    && authorityReplayObserved.containerInspectSha256
      === sha256Bytes(authorityContainerInspectBytes)
    && /^[0-9a-f]{64}$/.test(String(authorityReplayEffective?.containerId || ''))
    && authorityReplayEffective.containerId
      !== reproductionBundle?.executionEvidenceCore?.environment?.observed
        ?.effectiveIsolation?.containerId
    && authorityRawContainer?.Id === authorityReplayEffective.containerId
    && authorityRawContainer?.Image === campaign.researchProgram.environment.imageId
    && authorityRawContainer?.HostConfig?.NetworkMode === 'none'
    && authorityRawContainer?.HostConfig?.ReadonlyRootfs === true
    && authorityRawContainer?.HostConfig?.Privileged === false
    && authorityRawContainer?.HostConfig?.PidsLimit === 256
    && authorityRawContainer?.HostConfig?.Runtime
      === authorityResearchRuntime?.daemonClosure?.derivedTopology?.defaultRuntimeName
    && canonicalJson(authorityRawContainer?.HostConfig?.LogConfig)
      === canonicalJson({ Type: 'none', Config: {} })
    && canonicalJson([...(authorityRawContainer?.HostConfig?.CapDrop || [])].sort())
      === canonicalJson(['ALL'])
    && (authorityRawContainer?.HostConfig?.CapAdd || []).length === 0
    && (authorityRawContainer?.HostConfig?.Devices || []).length === 0
    && Array.isArray(authoritySecurityOpt)
    && canonicalJson([...authoritySecurityOpt].sort()) === canonicalJson([
      'apparmor=docker-default',
      'no-new-privileges',
      `seccomp=${
        authorityResearchRuntime?.daemonClosure?.derivedTopology?.seccompProfilePath
      }`,
    ].sort())
    && authorityRawContainer?.HostConfig?.Tmpfs?.['/tmp']
      === 'rw,noexec,nosuid,nodev,size=64m'
    && authorityRawMounts.length === 1
    && authorityRawContainer?.Config?.WorkingDir === '/workspace'
    && canonicalJson(authorityReplayEffective) === canonicalJson({
      containerId: authorityReplayEffective?.containerId,
      imageId: campaign.researchProgram.environment.imageId,
      network: 'none',
      rootFilesystem: 'read_only',
      noNewPrivileges: true,
      privileged: false,
      capabilities: 'none',
      addedCapabilities: 'none',
      devices: 'none',
      pidLimit: 256,
      temporaryFilesystem: 'rw_noexec_nosuid_nodev_64m',
      workspaceMount: {
        type: 'bind',
        source: authorityReplayCwd,
        destination: '/workspace',
        readWrite: true,
      },
      workingDirectory: '/workspace',
    })
    && canonicalEqual(authorityReplayObserved.runtimeCommands, authorityExpectedCommands)
    && canonicalEqual(
      authorityReplayObserved.isolation,
      reproductionBundle?.executionEvidenceCore?.environment?.observed?.isolation,
    )
    && canonicalEqual(
      authorityReplayObserved.processEnvironment,
      { LANG: 'C', LC_ALL: 'C' },
    )
    && authorityReplayObserved.runtimeLockDigest
      === campaign.researchProgram.environment.lockDigest
    && authorityKernelValidation.ok
    && authorityReplayObserved.kernelEvidence.rootfs.contentSha256
      === reproductionBundle?.executionEvidenceCore?.environment?.observed
        ?.kernelEvidence?.rootfs?.contentSha256
    && authorityReplayObserved.kernelEvidence.init.executable.sha256
      === reproductionBundle?.executionEvidenceCore?.environment?.observed
        ?.kernelEvidence?.init?.executable?.sha256
    && authorityReplayObserved.kernelEvidence.evidenceSha256
      !== reproductionBundle?.executionEvidenceCore?.environment?.observed
        ?.kernelEvidence?.evidenceSha256;
  const authorityMeasurementValid = exactKeys(authorityMeasurement, [
    'approvedResearchRuntimeSha256', 'authorityResearchRuntime',
    'authorityResearchRuntimeSha256', 'daemonClosureSha256',
    'containerInspectSha256', 'daemonMeasurements', 'effectiveIsolationSha256',
    'imageId', 'imageInspectSha256', 'isolation', 'isolationSha256',
    'replayExecutionEvidenceCore', 'replayExecutionEvidenceSha256',
    'replayOutputsDigest', 'replayResultDigest', 'requestSha256',
    'schemaVersion',
  ])
    && authorityMeasurement.schemaVersion
      === 'cortex.learning_os.research_reproduction_authority_measurement.v1'
    && authorityMeasurement.requestSha256 === reproductionBundle?.authorityRequestSha256
    && authorityMeasurement.approvedResearchRuntimeSha256
      === authorityResearchRuntimeSha256
    && authorityMeasurement.authorityResearchRuntimeSha256
      === authorityResearchRuntimeSha256
    && authorityMeasurement.daemonClosureSha256
      === authorityResearchRuntime?.daemonClosureSha256
    && independentAuthoritySubstrate
    && canonicalJson(authorityMeasurement.daemonMeasurements)
      === canonicalJson(authorityReplayObserved?.daemonMeasurements)
    && authorityMeasurement.imageId === reproductionBundle?.environment?.imageId
    && authorityMeasurement.imageInspectSha256
      === authorityReplayObserved?.imageInspectSha256
    && authorityMeasurement.containerInspectSha256
      === authorityReplayObserved?.containerInspectSha256
    && authorityMeasurement.effectiveIsolationSha256 === digest(
      authorityReplayEffective,
    )
    && canonicalEqual(
      authorityMeasurement.isolation,
      reproductionBundle?.executionEvidenceCore?.environment?.observed?.isolation,
    )
    && authorityMeasurement.isolationSha256
      === digest(authorityMeasurement.isolation)
    && authorityReplayValidation.ok
    && authorityMeasurement.replayExecutionEvidenceSha256 === digest(authorityReplayCore)
    && authorityMeasurement.replayExecutionEvidenceSha256
      !== reproductionBundle?.executionEvidenceSha256
    && authorityReplayCore?.bindings?.candidateSessionId
      === reproductionBundle?.executionEvidenceCore?.bindings?.candidateSessionId
    && authorityReplayCore?.bindings?.candidateSha256
      === reproductionBundle?.executionEvidenceCore?.bindings?.candidateSha256
    && authorityReplayCore?.bindings?.taskSha256
      === reproductionBundle?.executionEvidenceCore?.bindings?.taskSha256
    && authorityReplayCore?.bindings?.campaignId === campaign.campaignId
    && authorityReplayCore?.bindings?.campaignSha256
      === reproductionBundle?.executionEvidenceCore?.bindings?.campaignSha256
    && authorityReplayCore?.bindings?.deploymentSha256
      === reproductionBundle?.executionEvidenceCore?.bindings?.deploymentSha256
    && authorityReplayCore?.bindings?.sourceSha256
      === reproductionBundle?.sourceBundleSha256
    && authorityReplayCore?.bindings?.jobId
      === `${campaign.campaignId}.research-reproduction-authority-replay`
    && authorityReplayCore?.bindings?.jobSha256
      === reproductionBundle?.authorityRequestSha256
    && canonicalEqual(
      authorityReplayCore?.environment?.declared,
      reproductionBundle?.environment,
    )
    && authorityObservedValid
    && authorityReplayCwd !== reproductionBundle?.executionEvidenceCore?.command?.cwd
    && canonicalJson(authorityReplayCore?.command?.requestedArgv)
      === canonicalJson(authorityExpectedRun)
    && canonicalJson(authorityReplayCore?.command?.executedArgv)
      === canonicalJson(['/proc/self/fd/4', ...authorityExpectedRun.slice(1)])
    && canonicalJson(authorityReplayCore?.command?.executable)
      === canonicalJson({
        invoked: authorityResearchRuntime?.path,
        resolvedPath: '/proc/self/fd/4',
        bytes: authorityResearchRuntime?.bytes,
        sha256: authorityResearchRuntime?.sha256,
      })
    && authorityReplayCore?.input?.sha256 === reproductionBundle?.sourceBundleSha256
    && authorityReplayCore?.process?.exitCode === 0
    && authorityReplayCore?.process?.signal === null
    && authorityReplayCore?.process?.error === null
    && Date.parse(authorityReplayCore?.process?.startedAt)
      >= Date.parse(reproductionBundle?.completedAt)
    && Date.parse(authorityReplayCore?.process?.completedAt)
      >= Date.parse(authorityReplayCore?.process?.startedAt)
    && Date.parse(authorityReplayCore?.process?.completedAt) <= Date.parse(campaign.expiresAt)
    && canonicalEqual(
      authorityReplayOutputFiles,
      reproductionBundle?.executionEvidenceCore?.outputs?.files,
    )
    && authorityMeasurement.replayOutputsDigest === digest(authorityReplayOutputFiles)
    && authorityMeasurement.replayResultDigest === reproductionBundle?.resultDigest;
  if (!authorityMeasurementValid) {
    errors.push(
      'independent research authority replay or live runtime measurement is invalid',
      ...authorityReplayValidation.errors.map((error) => (
        `research authority replay: ${error}`
      )),
      ...authorityKernelValidation.errors.map((error) => (
        `research authority kernel evidence: ${error}`
      )),
      ...authorityResearchRuntimeValidation.errors.map((error) => (
        `research authority substrate: ${error}`
      )),
    );
  }
  if (!verifyAuthorityAttestation(reproductionBundle?.attestation, {
    trustPolicy: campaign.trustPolicy,
    capability: 'research_reproduction',
  }) || !canonicalEqual(reproductionBundle?.attestation?.payload, authorityPayload)) {
    errors.push('independent research reproduction passed-outcome attestation is invalid');
  }

  let reviewRequest = null;
  if (!validateResearchReviewRequestBinding(reviewRequestBinding)) {
    errors.push('authenticated research review request binding is invalid');
  } else {
    try {
      reviewRequest = parseResearchReviewAuthorityRequestBytes(
        Buffer.from(reviewRequestBinding.requestBytesBase64, 'base64'),
      ).request;
    } catch (error) {
      errors.push(error.message);
    }
  }
  errors.push(...authenticatedIntervalErrors({
    startedAt: reviewRequestBinding?.requestStartedAt,
    completedAt: reviewRequestBinding?.requestCompletedAt,
    notBefore: campaign.frozenAt,
    notAfter: campaign.expiresAt,
    minimumStartedAt: candidatePayload?.completedAt,
    label: 'research review request',
  }));
  if (reviewRequest?.campaignId !== campaign.campaignId
      || reviewRequest?.requestJobId
        !== `${campaign.campaignId}.research-review-request`
      || reviewRequest?.requestSessionId
        !== campaign.roles?.researchReviewRequestSession
      || reviewRequest?.candidateBinding?.jobId
        !== `${campaign.campaignId}.research_candidate`
      || reviewRequest?.candidateBinding?.candidateSessionId
        !== campaign.roles?.researchCandidateSession
      || reviewRequest?.candidateBinding?.artifactDigest !== artifactDigest
      || reviewRequest?.candidateBinding?.resultDigest !== resultDigest
      || !canonicalEqual(reviewRequest?.candidateBinding?.result, result)
      || reviewRequest?.boundedClaim !== campaign.researchProgram?.boundedClaim
      || reviewRequest?.corpusDigest !== campaign.researchProgram?.corpusDigest
      || reviewRequest?.assumptionsDigest !== campaign.researchProgram?.assumptionsDigest
      || reviewRequest?.claimSemanticsSha256
        !== campaign.researchProgram?.formalization?.claimSemanticsSha256) {
    errors.push('research review request exact candidate or bounded scope is invalid');
  }

  const reviewStartedAt = reviewAttestation?.payload?.startedAt;
  const reviewCompletedAt = reviewAttestation?.payload?.completedAt;
  errors.push(...authenticatedIntervalErrors({
    startedAt: reviewStartedAt,
    completedAt: reviewCompletedAt,
    notBefore: campaign.frozenAt,
    notAfter: campaign.expiresAt,
    minimumStartedAt: reviewRequestBinding?.requestCompletedAt,
    label: 'research review',
  }));
  const reviewResult = reviewAttestation?.payload?.reviewResult;
  const reviewResultDigest = validateResearchReviewResult(reviewResult)
    ? digest(reviewResult)
    : null;
  const findingsDigest = validateResearchReviewResult(reviewResult)
    ? digest(reviewResult.findings)
    : null;
  if (reviewResultDigest === null || findingsDigest === null) {
    errors.push('independent research review result or findings are invalid');
  }
  const reviewPayload = {
    schemaVersion: 'cortex.learning_os.research_review_authority_payload.v2',
    requestSha256: reviewRequestBinding?.requestSha256 ?? null,
    requestJobId: reviewRequestBinding?.requestJobId ?? null,
    requestJobDigest: reviewRequestBinding?.requestJobDigest ?? null,
    requestSessionId: reviewRequestBinding?.requestSessionId ?? null,
    campaignId: campaign.campaignId,
    candidateBinding: structuredClone(reviewRequest?.candidateBinding ?? null),
    boundedClaim: reviewRequest?.boundedClaim ?? null,
    corpusDigest: reviewRequest?.corpusDigest ?? null,
    assumptionsDigest: reviewRequest?.assumptionsDigest ?? null,
    artifactDigest,
    resultDigest,
    claimSemanticsSha256: campaign.researchProgram?.formalization?.claimSemanticsSha256 ?? null,
    reviewResult: structuredClone(reviewResult),
    reviewResultDigest,
    findingsDigest,
    startedAt: reviewStartedAt,
    completedAt: reviewCompletedAt,
    candidateExecutionAttestationDigest: candidateAttestationSha256,
    candidateStartedAt: candidatePayload?.startedAt ?? null,
    candidateCompletedAt: candidatePayload?.completedAt ?? null,
  };
  if (!verifyAuthorityAttestation(reviewAttestation, {
    trustPolicy: campaign.trustPolicy,
    capability: 'research_review',
  }) || canonicalJson(reviewAttestation?.payload) !== canonicalJson(reviewPayload)) {
    errors.push('independent adversarial research review execution binding is invalid');
  }
  return {
    ok: errors.length === 0,
    errors,
    reproductionPayload,
    reviewPayload,
  };
}

function harvestedReproductionBundleMatches({
  campaign,
  qualificationPlan,
  reproductionBundle,
  harvest,
} = {}) {
  const jobId = `${campaign?.campaignId}.research-reproduction`;
  const receipt = harvest?.receiptsByJob?.get(jobId);
  const manifest = harvest?.manifestsByJob?.get(jobId);
  const files = harvest?.filesByJob?.get(jobId);
  const job = qualificationPlan?.jobs?.find((candidate) => candidate.jobId === jobId);
  if (!receipt || !manifest || !files || !job) return false;
  let request;
  try {
    const requestBytes = files.get('reproduction-authority-request.json');
    const outputBytes = files.get('output.json');
    if (!requestBytes || !outputBytes || !requestBytes.equals(outputBytes)) return false;
    request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(requestBytes));
  } catch {
    return false;
  }
  const exactOutputs = new Map((reproductionBundle?.outputs || []).map((output) => [
    output.path,
    Buffer.from(output.contentBase64 || '', 'base64'),
  ]));
  return request.schemaVersion === RESEARCH_REPRODUCTION_REQUEST_SCHEMA
    && reproductionBundle.authorityRequestBytesBase64 === requestBytes.toString('base64')
    && reproductionBundle.authorityRequestSha256 === sha256Bytes(requestBytes)
    && request.status === 'ready_for_independent_authority'
    && request.startedAt === receipt.startedAt
    && request.completedAt === receipt.completedAt
    && reproductionBundle.startedAt === receipt.startedAt
    && reproductionBundle.completedAt === receipt.completedAt
    && request.commandDigest === reproductionBundle.commandDigest
    && request.sourceBundleSha256 === reproductionBundle.sourceBundleSha256
    && request.recomputedResultDigest === reproductionBundle.resultDigest
    && request.expectedResultDigest === reproductionBundle.resultDigest
    && canonicalJson(request.executionEvidenceCore)
      === canonicalJson(reproductionBundle.executionEvidenceCore)
    && request.executionEvidenceSha256 === reproductionBundle.executionEvidenceSha256
    && canonicalJson(request.requestedAttestationPayload)
      === canonicalJson(reproductionBundle.attestation?.payload?.reproductionPayload)
    && request.requestedAttestationPayloadSha256
      === sha256Bytes(Buffer.from(canonicalJson(request.requestedAttestationPayload), 'utf8'))
    && request.requestedAttestationPayloadBytesBase64
      === Buffer.from(canonicalJson(request.requestedAttestationPayload), 'utf8').toString('base64')
    && reproductionBundle.attestation?.payload?.requestSha256 === sha256Bytes(requestBytes)
    && request.executionEvidenceCore?.bindings?.jobId === jobId
    && request.executionEvidenceCore?.bindings?.jobSha256 === receipt.jobDigest
    && request.logs?.stdoutSha256 === reproductionBundle.stdoutSha256
    && request.logs?.stderrSha256 === reproductionBundle.stderrSha256
    && (files.get(request.logs?.stdout) || Buffer.alloc(0))
      .equals(Buffer.from(reproductionBundle.stdoutBase64 || '', 'base64'))
    && (files.get(request.logs?.stderr) || Buffer.alloc(0))
      .equals(Buffer.from(reproductionBundle.stderrBase64 || '', 'base64'))
    && request.outputs?.length === exactOutputs.size
    && request.outputs.every((output) => (
      exactOutputs.has(output.path)
      && output.sha256 === sha256Bytes(exactOutputs.get(output.path))
      && (files.get(`outputs/${output.path}`) || Buffer.alloc(0))
        .equals(exactOutputs.get(output.path))
    ))
    && manifest.outputSha256 === sha256Bytes(files.get('output.json'));
}

function harvestedResearchReviewRequestBinding({
  campaign,
  qualificationPlan,
  harvest,
} = {}) {
  const requestJobId = `${campaign?.campaignId}.research-review-request`;
  const candidateJobId = `${campaign?.campaignId}.research_candidate`;
  const requestReceipt = harvest?.receiptsByJob?.get(requestJobId);
  const requestManifest = harvest?.manifestsByJob?.get(requestJobId);
  const requestFiles = harvest?.filesByJob?.get(requestJobId);
  const candidateReceipt = harvest?.receiptsByJob?.get(candidateJobId);
  const candidateManifest = harvest?.manifestsByJob?.get(candidateJobId);
  const candidateFiles = harvest?.filesByJob?.get(candidateJobId);
  const requestJob = qualificationPlan?.jobs?.find((job) => job.jobId === requestJobId);
  const candidateJob = qualificationPlan?.jobs?.find((job) => job.jobId === candidateJobId);
  if (!requestReceipt || !requestManifest || !requestFiles
      || !candidateReceipt || !candidateManifest || !candidateFiles
      || !requestJob || !candidateJob) {
    return null;
  }
  try {
    const requestBytes = requestFiles.get('research-review-authority-request.json');
    const outputBytes = requestFiles.get('output.json');
    const candidateOutputBytes = candidateFiles.get('output.json');
    if (!requestBytes || !outputBytes || !candidateOutputBytes
        || !requestBytes.equals(outputBytes)) {
      return null;
    }
    const parsedCandidate = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(candidateOutputBytes),
    );
    if (!exactKeys(parsedCandidate, ['artifact', 'novelty', 'result'])
        || !isRecord(parsedCandidate.artifact)) {
      return null;
    }
    const candidateBinding = {
      jobId: candidateJobId,
      candidateSessionId: candidateJob.sessionId,
      outputSha256: candidateManifest.outputSha256,
      artifact: structuredClone(parsedCandidate.artifact),
      artifactDigest: digest(parsedCandidate.artifact),
      result: structuredClone(parsedCandidate.result),
      resultDigest: digest(parsedCandidate.result),
      harvestedAuthority: 'worker_evidence_only',
    };
    const expectedRequest = createResearchReviewAuthorityRequest({
      job: requestJob,
      candidateBinding,
    });
    const parsedRequest = parseResearchReviewAuthorityRequestBytes(requestBytes);
    const expectedBytes = serializeResearchReviewAuthorityRequest(expectedRequest);
    if (!requestBytes.equals(expectedBytes)
        || canonicalJson(parsedRequest.request) !== canonicalJson(expectedRequest)
        || requestReceipt.jobDigest !== digest(requestJob)
        || requestManifest.outputSha256 !== sha256Bytes(outputBytes)
        || requestReceipt.startedAt !== requestManifest.startedAt
        || requestReceipt.completedAt !== requestManifest.completedAt
        || candidateReceipt.jobDigest !== digest(candidateJob)
        || candidateManifest.outputSha256 !== sha256Bytes(candidateOutputBytes)
        || requestJob.task.boundedClaim !== campaign.researchProgram.boundedClaim
        || requestJob.task.corpusDigest !== campaign.researchProgram.corpusDigest
        || requestJob.task.assumptionsDigest !== campaign.researchProgram.assumptionsDigest
        || requestJob.task.claimSemanticsSha256
          !== campaign.researchProgram.formalization.claimSemanticsSha256) {
      return null;
    }
    return createResearchReviewRequestBinding({
      requestBytes,
      requestJobDigest: requestReceipt.jobDigest,
      requestStartedAt: requestReceipt.startedAt,
      requestCompletedAt: requestReceipt.completedAt,
    });
  } catch {
    return null;
  }
}

export function assembleProductionResearchEvidence({
  campaign,
  qualificationPlan = null,
  harvestState = null,
  artifactManifestBytesByJob = null,
  artifactFileBytesByJob = null,
  harvestObservedAt = null,
  signingSecret = null,
  candidateCall,
  candidateOutputBytes,
  candidateRawEventLedgerBytes,
  candidateRawStderrBytes = Buffer.alloc(0),
  reproductionBundle,
  reviewAttestation,
  reviewRequestBinding = null,
} = {}) {
  if (campaign?.fixtureOnly !== false) {
    throw new Error('production research assembly rejects fixture campaigns');
  }
  const rawOutput = Buffer.isBuffer(candidateOutputBytes)
    ? candidateOutputBytes
    : Buffer.from(candidateOutputBytes || '');
  let parsed;
  try { parsed = JSON.parse(rawOutput.toString('utf8')); } catch { parsed = null; }
  if (!isRecord(parsed)
      || Object.keys(parsed).sort().join(',') !== 'artifact,novelty,result'
      || !isRecord(parsed.artifact)
      || !isRecord(parsed.novelty)
      || candidateCall?.role !== 'research_candidate'
      || !validWorkerExecutionIdentity(campaign, candidateCall)
      || (candidateCall.plannedSessionId || candidateCall.sessionId)
        !== campaign.roles.researchCandidateSession
      || candidateCall.outputSha256 !== sha256Text(rawOutput)) {
    throw new Error('production research candidate raw output or role binding is invalid');
  }
  const qualificationHarvestBinding = productionHarvestBindingForWorker({
    campaign,
    qualificationPlan,
    harvestState,
    artifactManifestBytesByJob,
    artifactFileBytesByJob,
    signingSecret,
    harvestObservedAt,
    workerCall: candidateCall,
    expectedJobId: `${campaign.campaignId}.research_candidate`,
    workerOutputBytes: rawOutput,
    workerRawEventLedgerBytes: candidateRawEventLedgerBytes,
    workerRawStderrBytes: candidateRawStderrBytes,
  });
  let exactReviewRequestBinding = reviewRequestBinding;
  if (campaign.schemaVersion === PHD_CAMPAIGN_SCHEMA) {
    const exactHarvest = verifyQualificationHarvestEvidence({
      plan: qualificationPlan,
      harvestState,
      artifactManifestBytesByJob,
      artifactFileBytesByJob,
      campaign,
      signingSecret,
      now: harvestObservedAt,
      requireArtifactManifests: true,
      requireArtifactFiles: true,
    });
    exactReviewRequestBinding = harvestedResearchReviewRequestBinding({
      campaign,
      qualificationPlan,
      harvest: exactHarvest,
    });
    if (!exactHarvest.ok || !harvestedReproductionBundleMatches({
      campaign,
      qualificationPlan,
      reproductionBundle,
      harvest: exactHarvest,
    }) || exactReviewRequestBinding === null) {
      throw new Error('production research reproduction or review request is not the exact harvested planned execution');
    }
  }
  if (!validateResearchReviewRequestBinding(exactReviewRequestBinding)) {
    throw new Error('production research review request binding is invalid');
  }
  const artifactDigest = digest(parsed.artifact);
  const resultDigest = digest(parsed.result);
  const candidateExecution = workerExecution(candidateCall, campaign, {
    artifactDigest,
    rawOutputBase64: rawOutput.toString('base64'),
    rawEventLedgerBase64: Buffer.from(candidateRawEventLedgerBytes || '').toString('base64'),
    rawStderrBase64: Buffer.from(candidateRawStderrBytes).toString('base64'),
  });
  const attestationValidation = validateProductionResearchAttestations({
    campaign,
    artifactDigest,
    result: parsed.result,
    resultDigest,
    candidateExecution,
    reproductionBundle,
    reviewAttestation,
    reviewRequestBinding: exactReviewRequestBinding,
    harvestedWorkerCall: campaign.schemaVersion === PHD_CAMPAIGN_SCHEMA
      ? candidateCall
      : null,
  });
  if (!attestationValidation.ok) {
    throw new Error(`production research execution, reproduction, or review assembly failed: ${attestationValidation.errors.join('; ')}`);
  }
  return {
    candidateSessionId: campaign.roles.researchCandidateSession,
    artifact: structuredClone(parsed.artifact),
    artifactDigest,
    result: structuredClone(parsed.result),
    resultDigest,
    sourceBundleSha256: reproductionBundle.sourceBundleSha256,
    environmentDigest: reproductionBundle.environmentDigest,
    mainTheoremTemplateSha256: campaign.researchProgram.formalization.templateSha256,
    candidateExecution,
    qualificationHarvestBinding: structuredClone(qualificationHarvestBinding),
    reproduction: structuredClone(reproductionBundle),
    review: {
      request: structuredClone(exactReviewRequestBinding),
      attestation: structuredClone(reviewAttestation),
    },
    novelty: structuredClone(parsed.novelty),
  };
}

function canonicalProofTaskMaterializations(campaign, fixtureResearchArtifactDigest) {
  return campaign.proofTemplates.map((frozen) => {
    let taskBytes;
    let trustedTemplateBytes;
    if (frozen.frozenTaskBase64 !== null && frozen.frozenTemplateBase64 !== null) {
      taskBytes = Buffer.from(frozen.frozenTaskBase64, 'base64');
      trustedTemplateBytes = Buffer.from(frozen.frozenTemplateBase64, 'base64');
      if (sha256Text(taskBytes) !== frozen.frozenTaskSha256
          || sha256Text(trustedTemplateBytes) !== frozen.frozenTemplateSha256) {
        throw new Error(`campaign-frozen proof bytes drifted: ${frozen.obligationId}`);
      }
    } else {
      if (campaign.fixtureOnly !== true
          || frozen.obligationId !== 'formal-proof-research-main-result'
          || !DIGEST.test(String(fixtureResearchArtifactDigest || ''))) {
        throw new Error(`campaign proof task is not materializable: ${frozen.obligationId}`);
      }
      const materialized = createObligationProofTask({
        obligationId: frozen.obligationId,
        researchArtifactDigest: fixtureResearchArtifactDigest,
        expectedTheoremStatementSha256: frozen.theoremStatementSha256,
        fixtureOnly: true,
        deployment: campaign.deployment,
        runId: frozen.taskIdentity.runId,
        seed: frozen.taskIdentity.seed,
      });
      taskBytes = materialized.taskBytes;
      trustedTemplateBytes = materialized.trustedTemplateBytes;
    }
    const taskEnvelope = parseProofRecordBytes(taskBytes, 'campaign-frozen proof task');
    if (!validateProofTask(taskEnvelope.record).ok
        || taskEnvelope.record.conceptId !== frozen.obligationId
        || taskEnvelope.record.theorem.statementSha256 !== frozen.theoremStatementSha256
        || taskEnvelope.record.theorem.templateSha256 !== sha256Text(trustedTemplateBytes)) {
      throw new Error(`campaign-frozen proof task identity mismatch: ${frozen.obligationId}`);
    }
    return {
      obligationId: frozen.obligationId,
      task: taskEnvelope.record,
      taskBytes,
      trustedTemplateBytes,
      researchArtifactDigest: frozen.obligationId === 'formal-proof-research-main-result'
        ? fixtureResearchArtifactDigest
        : null,
    };
  });
}

function retentionJobDescriptors({ campaign, retentionAssignments, signingSecret }) {
  if (!Array.isArray(retentionAssignments)) throw new Error('retention assignments must be an array');
  if (retentionAssignments.length !== campaign.roles.retentionSessions.length) {
    throw new Error('every campaign-declared retention role requires one exact signed task and release');
  }
  return retentionAssignments.map((assignment, index) => {
    const task = assignment?.task;
    const release = assignment?.release;
    const sessionId = campaign.roles.retentionSessions[index];
    if (task?.schemaVersion !== 'cortex.learning_os.retention_window_task.v2'
        || !verifySignature(task, signingSecret)
        || release?.schemaVersion !== 'cortex.learning_os.retention_window_release.v1'
        || release.taskId !== task.taskId
        || release.subjectId !== campaign.subjectId
        || release.windowIndex !== task.windowIndex
        || release.taskDigest !== digest(task)
        || release.promptCommitmentDigest !== task.promptCommitmentDigest
        || task.deploymentDigest !== campaign.deploymentDigest) {
      throw new Error(`invalid retention assignment for session ${sessionId}`);
    }
    const prompt = buildRetentionWorkerPrompt(release);
    return {
      jobId: `${campaign.campaignId}.retention.${task.windowIndex}`,
      role: 'retention',
      sessionId,
      executor: 'model_no_tools',
      dependencies: [],
      prompt,
      outputSchema: 'model-answer-output.schema.json',
      task: {
        schemaVersion: 'cortex.learning_os.retention_job_task.v1',
        signedTask: task,
        release,
        taskSha256: digest(task),
        releaseSha256: digest(release),
      },
      timeoutSeconds: 1800,
    };
  });
}

function validProofDescriptorTask(task, dependencies, {
  production = false,
  campaignId = null,
} = {}) {
  const validation = validateProofCandidateJobTask(task);
  if (!validation.ok || !Array.isArray(dependencies)) return false;
  const dependent = task.schemaVersion === DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA;
  if (production && task.obligationId === 'formal-proof-research-main-result'
      && (!dependent
        || task.researchArtifactSource.dependencyJobId
          !== `${campaignId}.research_candidate`)) {
    return false;
  }
  return canonicalJson(dependencies) === canonicalJson(
    dependent ? [task.researchArtifactSource.dependencyJobId] : [],
  );
}

function validFormalResearchMaterializationTask(task, dependencies, {
  production = false,
  campaignId = null,
} = {}) {
  if (!exactKeys(task, [
    'claimSemanticsSha256', 'obligationId', 'proofTask',
    'researchArtifactSource', 'schemaVersion',
  ])
      || task.schemaVersion !== 'cortex.learning_os.formal_research_materialization_task.v1'
      || task.obligationId !== 'formal-proof-research-main-result'
      || task.proofTask?.obligationId !== task.obligationId
      || !validateProofCandidateJobTask(task.proofTask).ok) {
    return false;
  }
  const dependent = task.proofTask.schemaVersion
    === DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA;
  if (production && (!dependent
      || task.proofTask.researchArtifactSource.dependencyJobId
        !== `${campaignId}.research_candidate`)) {
    return false;
  }
  return canonicalJson(task.researchArtifactSource)
      === canonicalJson(dependent ? task.proofTask.researchArtifactSource : null)
    && canonicalJson(dependencies) === canonicalJson(
      dependent ? [task.proofTask.researchArtifactSource.dependencyJobId] : [],
    );
}

function dependentResearchArtifactSourceMatchesPlan(task, jobs) {
  if (task?.schemaVersion !== DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA) {
    return true;
  }
  const source = task.researchArtifactSource;
  const sourceJob = jobs?.find((job) => job?.jobId === source?.dependencyJobId);
  return sourceJob?.role === 'research_candidate'
    && sourceJob.sessionId === source.candidateSessionId
    && sourceJob.promptSha256 === source.candidatePromptSha256
    && canonicalJson(sourceJob.dependencies) === canonicalJson([]);
}

function productionResearchMainPlanErrors({
  campaignId,
  jobs,
  protectedAuthorityTasks,
} = {}) {
  const errors = [];
  const researchJobId = `${campaignId}.research_candidate`;
  const proofJobId = `${campaignId}.formal-proof-research-main-result`;
  const materializationJobId = `${campaignId}.formal-research-theorem`;
  const researchJobs = jobs.filter((job) => (
    job?.jobId === researchJobId && job?.role === 'research_candidate'
  ));
  const declaredProofJobs = jobs.filter((job) => (
    job?.role === 'proof_candidate'
      && job?.task?.obligationId === 'formal-proof-research-main-result'
  ));
  const proofJobs = jobs.filter((job) => (
    job?.jobId === proofJobId
      && job?.role === 'proof_candidate'
      && job?.task?.obligationId === 'formal-proof-research-main-result'
  ));
  const declaredMaterializationJobs = jobs.filter((job) => (
    job?.role === 'formal_research_theorem'
  ));
  const materializationJobs = jobs.filter((job) => (
    job?.jobId === materializationJobId && job?.role === 'formal_research_theorem'
  ));
  const researchJob = researchJobs[0];
  const proofJob = proofJobs[0];
  const materializationJob = materializationJobs[0];
  const proofTask = proofJob?.task;
  const materializationProofTask = materializationJob?.task?.proofTask;
  const source = proofTask?.researchArtifactSource;
  if (declaredProofJobs.length === 0 && declaredMaterializationJobs.length === 0) {
    return errors;
  }
  if (researchJobs.length !== 1
      || declaredProofJobs.length !== 1 || proofJobs.length !== 1
      || declaredMaterializationJobs.length !== 1 || materializationJobs.length !== 1) {
    errors.push('production plan requires one exact research, research-main proof, and materialization job');
    return errors;
  }
  if (!validateProofCandidateJobTask(proofTask).ok
      || proofTask.schemaVersion !== DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA
      || source?.dependencyJobId !== researchJobId
      || source?.candidateSessionId !== researchJob.sessionId
      || source?.candidatePromptSha256 !== researchJob.promptSha256
      || canonicalJson(researchJob.dependencies) !== canonicalJson([])
      || canonicalJson(proofJob.dependencies) !== canonicalJson([researchJobId])) {
    errors.push('production research-main proof is not dependent on the exact research candidate job');
  }
  if (materializationJob.executor !== 'frozen_task_materialization'
      || canonicalJson(materializationJob.dependencies) !== canonicalJson([researchJobId])
      || canonicalJson(materializationProofTask) !== canonicalJson(proofTask)
      || canonicalJson(materializationJob.task.researchArtifactSource)
        !== canonicalJson(source)
      || materializationJob.task.claimSemanticsSha256
        !== proofTask?.claimSemanticsSha256) {
    errors.push('production research-main proof and materialization do not share one exact proof task');
  }
  const replayTask = protectedAuthorityTasks.find((task) => (
    task?.taskId === `${proofJobId}.protected-replay`
      && task?.role === 'proof_replay'
      && task?.sessionId === proofTask?.replaySessionId
  ));
  if (!replayTask
      || canonicalJson(replayTask.dependsOn)
        !== canonicalJson([proofJobId, materializationJobId])
      || replayTask.exactTaskBytesSha256 !== proofTask?.taskBytesSha256
      || replayTask.exactTemplateSha256 !== proofTask?.trustedTemplateSha256
      || replayTask.claimSemanticsSha256 !== proofTask?.claimSemanticsSha256
      || replayTask.proofTaskSha256 !== digest(proofTask)
      || replayTask.authorityCapability !== 'proof_replay') {
    errors.push('production protected replay is not bound to the exact research-main proof task');
  }
  return errors;
}

export function buildCanonicalQualificationJobs({
  campaign,
  sealedBanks,
  releasedAtByExam,
  retentionAssignments = [],
  fixtureResearchArtifactDigest = null,
  signingSecret,
} = {}) {
  assertCampaignFixtureOnly(campaign);
  if (campaign?.schemaVersion !== PHD_CAMPAIGN_SCHEMA || !verifySignature(campaign, signingSecret)) {
    throw new Error('cannot construct canonical jobs from an unsigned campaign');
  }
  const sourceValidation = validateResearchSourceBundle(campaign.researchProgram?.sourceBundle);
  if (!sourceValidation.ok
      || researchSourceBundleDigest(campaign.researchProgram.sourceBundle)
        !== campaign.researchProgram.sourceBundleSha256) {
    throw new Error(`canonical research source bundle is incomplete: ${sourceValidation.errors.join('; ')}`);
  }
  const researchCandidate = buildResearchJobDescriptor({
    campaign,
    role: 'research_candidate',
  });
  const proofTasks = canonicalProofTaskMaterializations(campaign, fixtureResearchArtifactDigest);
  const proofDescriptors = buildProofCandidateJobDescriptors({
    campaign,
    proofTasks,
    researchArtifactJob: researchCandidate,
  });
  const examDescriptors = buildExamJobDescriptors({ campaign, sealedBanks, releasedAtByExam });
  const mainProof = proofDescriptors.find((descriptor) => (
    descriptor.task.obligationId === 'formal-proof-research-main-result'
  ));
  const materializationJobId = `${campaign.campaignId}.formal-research-theorem`;
  const reviewRequestJobId = `${campaign.campaignId}.research-review-request`;
  const reproductionJobId = `${campaign.campaignId}.research-reproduction`;
  const formalMaterialization = {
    jobId: materializationJobId,
    role: 'formal_research_theorem',
    sessionId: campaign.roles.researchMaterializerSession,
    executor: 'frozen_task_materialization',
    dependencies: campaign.fixtureOnly === true ? [] : [researchCandidate.jobId],
    task: {
      schemaVersion: 'cortex.learning_os.formal_research_materialization_task.v1',
      obligationId: mainProof.task.obligationId,
      proofTask: mainProof.task,
      researchArtifactSource: mainProof.task.researchArtifactSource || null,
      claimSemanticsSha256: campaign.proofTemplates.find((row) => (
        row.obligationId === mainProof.task.obligationId
      )).claimSemanticsSha256,
    },
    timeoutSeconds: 60,
    maxOutputBytes: 2 * 1024 * 1024,
  };
  const reviewRequest = {
    jobId: reviewRequestJobId,
    role: 'research_review_request',
    sessionId: campaign.roles.researchReviewRequestSession,
    executor: 'authority_request_materialization',
    dependencies: [researchCandidate.jobId],
    task: {
      schemaVersion: 'cortex.learning_os.research_review_request_task.v1',
      campaignId: campaign.campaignId,
      candidateJobId: researchCandidate.jobId,
      candidateSessionId: researchCandidate.sessionId,
      candidatePromptSha256: sha256Text(researchCandidate.prompt),
      fixtureOnly: campaign.fixtureOnly,
      boundedClaim: campaign.researchProgram.boundedClaim,
      corpusDigest: campaign.researchProgram.corpusDigest,
      assumptionsDigest: campaign.researchProgram.assumptionsDigest,
      claimSemanticsSha256: campaign.researchProgram.formalization?.claimSemanticsSha256 || null,
    },
    timeoutSeconds: 60,
    maxOutputBytes: 2 * 1024 * 1024,
  };
  const reproduction = {
    jobId: reproductionJobId,
    role: 'reproduction',
    sessionId: campaign.roles.researchReproductionRunnerSession,
    executor: 'frozen_research_reproduction',
    dependencies: [researchCandidate.jobId],
    task: {
      schemaVersion: RESEARCH_REPRODUCTION_TASK_SCHEMA,
      campaignId: campaign.campaignId,
      candidateJobId: researchCandidate.jobId,
      candidateSessionId: researchCandidate.sessionId,
      candidatePromptSha256: sha256Text(researchCandidate.prompt),
      fixtureOnly: campaign.fixtureOnly,
      approvedResearchRuntime: campaign.fixtureOnly
        ? null
        : structuredClone(campaign.deployment.approvedResearchRuntime),
      approvedResearchRuntimeSha256: campaign.fixtureOnly
        ? null
        : digest(campaign.deployment.approvedResearchRuntime),
      sourceBundle: structuredClone(campaign.researchProgram.sourceBundle),
      sourceBundleSha256: campaign.researchProgram.sourceBundleSha256,
      environment: structuredClone(campaign.researchProgram.environment),
      environmentDigest: campaign.researchProgram.environmentDigest,
      command: structuredClone(campaign.researchProgram.reproduction.command),
      commandDigest: digest(campaign.researchProgram.reproduction.command),
      outputPaths: structuredClone(campaign.researchProgram.reproduction.outputPaths),
      resultPath: campaign.researchProgram.reproduction.resultPath,
      timeoutSeconds: campaign.researchProgram.reproduction.timeoutSeconds || 1800,
    },
    timeoutSeconds: campaign.researchProgram.reproduction.timeoutSeconds || 1800,
    maxOutputBytes: 16 * 1024 * 1024,
  };
  const descriptors = [
    researchCandidate,
    ...examDescriptors,
    ...proofDescriptors,
    formalMaterialization,
    reviewRequest,
    reproduction,
    ...retentionJobDescriptors({ campaign, retentionAssignments, signingSecret }),
  ];
  const protectedAuthorityTasks = [
    ...proofDescriptors.map((descriptor) => ({
      taskId: `${descriptor.jobId}.protected-replay`,
      role: 'proof_replay',
      sessionId: descriptor.task.replaySessionId,
      dependsOn: [descriptor.jobId, materializationJobId].filter((jobId) => (
        descriptor.task.obligationId === 'formal-proof-research-main-result'
          || jobId !== materializationJobId
      )),
      proofTaskSha256: digest(descriptor.task),
      exactTaskBytesSha256: descriptor.task.taskBytesSha256,
      exactTemplateSha256: descriptor.task.trustedTemplateSha256,
      claimSemanticsSha256: descriptor.task.claimSemanticsSha256,
      authorityCapability: 'proof_replay',
    })),
    {
      taskId: `${campaign.campaignId}.protected-research-review`,
      role: 'research_review',
      sessionId: campaign.roles.researchReviewerSession,
      dependsOn: [reviewRequestJobId],
      authorityCapability: 'research_review',
    },
    {
      taskId: `${campaign.campaignId}.protected-research-reproduction`,
      role: 'research_reproduction',
      sessionId: campaign.roles.researchReproducerSession,
      dependsOn: [reproductionJobId],
      authorityCapability: 'research_reproduction',
    },
  ];
  return buildDetachedQualificationJobs({
    campaign,
    descriptors,
    protectedAuthorityTasks,
    signingSecret,
  });
}

export function buildDetachedQualificationJobs({
  campaign,
  descriptors,
  protectedAuthorityTasks = [],
  signingSecret,
} = {}) {
  assertCampaignFixtureOnly(campaign);
  if (campaign?.schemaVersion !== PHD_CAMPAIGN_SCHEMA || !verifySignature(campaign, signingSecret)) {
    throw new Error('cannot build jobs from an unsigned campaign');
  }
  if (campaign.fixtureOnly !== true
      && campaign.deployment?.schemaVersion
        !== APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA) {
    throw new Error('production jobs require the campaign-approved model executable closure');
  }
  if (!Array.isArray(descriptors) || descriptors.length < 1 || descriptors.length > 64) {
    throw new Error('detached qualification job descriptors are invalid');
  }
  const campaignDigest = digest(campaign);
  const allowedSessionsByRole = {
    exam: new Set(campaign.roles.candidateSessions),
    proof_candidate: new Set(campaign.roles.proofCandidateSessions),
    research_candidate: new Set([campaign.roles.researchCandidateSession]),
    adversarial_review: new Set([campaign.roles.researchReviewerSession]),
    reproduction: new Set([
      campaign.roles.researchReproducerSession,
      campaign.roles.researchReproductionRunnerSession,
    ]),
    formal_research_theorem: new Set([campaign.roles.researchMaterializerSession]),
    research_review_request: new Set([campaign.roles.researchReviewRequestSession]),
    retention: new Set(campaign.roles.retentionSessions),
  };
  const jobs = descriptors.map((descriptor) => {
    const executor = descriptor?.executor || 'model_no_tools';
    const dependencies = descriptor?.dependencies || [];
    const allowedSessions = allowedSessionsByRole[descriptor?.role];
    if (campaign.fixtureOnly !== true
        && descriptor?.role === 'adversarial_review') {
      throw new Error('production research review must run under a protected non-model authority');
    }
    if ((descriptor?.role === 'formal_research_theorem'
        && executor !== 'frozen_task_materialization')
      || (descriptor?.role === 'research_review_request'
        && executor !== 'authority_request_materialization')
      || (descriptor?.role === 'reproduction'
        && campaign.fixtureOnly !== true
        && executor !== 'frozen_research_reproduction')
      || (executor === 'frozen_task_materialization'
        && descriptor?.role !== 'formal_research_theorem')
      || (executor === 'authority_request_materialization'
        && descriptor?.role !== 'research_review_request')
      || (executor === 'frozen_research_reproduction'
        && descriptor?.role !== 'reproduction')) {
      throw new Error('detached role cannot substitute its declared inert executor');
    }
    if (executor === 'authority_request_materialization'
        && (!validateResearchReviewRequestTask(descriptor.task)
          || descriptor.task.campaignId !== campaign.campaignId
          || descriptor.task.candidateJobId !== dependencies[0])) {
      throw new Error('detached research review request task scope is invalid');
    }
    if ((descriptor?.role === 'proof_candidate'
          && !validProofDescriptorTask(descriptor.task, dependencies, {
            production: campaign.fixtureOnly !== true,
            campaignId: campaign.campaignId,
          }))
        || (descriptor?.role === 'formal_research_theorem'
          && !validFormalResearchMaterializationTask(descriptor.task, dependencies, {
            production: campaign.fixtureOnly !== true,
            campaignId: campaign.campaignId,
          }))) {
      throw new Error('invalid detached qualification job descriptor');
    }
    if (!ID.test(String(descriptor?.jobId || ''))
        || !allowedSessions?.has(descriptor?.sessionId)
        || !['model_no_tools', 'frozen_task_materialization',
          'authority_request_materialization', 'frozen_research_reproduction'].includes(executor)
        || !Array.isArray(dependencies)
        || new Set(dependencies).size !== dependencies.length
        || dependencies.some((dependency) => !ID.test(String(dependency)))
        || (descriptor?.task !== undefined && descriptor.task !== null
          && !isRecord(descriptor.task))
        || (executor === 'model_no_tools' && (
          typeof descriptor?.prompt !== 'string' || descriptor.prompt.length < 1
          || descriptor.prompt.length > 1024 * 1024
          || !/^[A-Za-z0-9._-]+[.]schema[.]json$/.test(String(descriptor?.outputSchema || ''))
        ))
        || (executor !== 'model_no_tools' && !isRecord(descriptor?.task))) {
      throw new Error('invalid detached qualification job descriptor');
    }
    const promptBytes = Buffer.from(descriptor.prompt || canonicalJson(descriptor.task), 'utf8');
    const descriptorSha256 = digest({
      jobId: descriptor.jobId,
      role: descriptor.role,
      sessionId: descriptor.sessionId,
      executor,
      dependencies,
      promptBase64: promptBytes.toString('base64'),
      outputSchema: descriptor.outputSchema || null,
      task: descriptor.task || null,
      timeoutSeconds: descriptor.timeoutSeconds || 600,
      maxOutputBytes: descriptor.maxOutputBytes || 4 * 1024 * 1024,
    });
    return sign({
      schemaVersion: PHD_DETACHED_JOB_SCHEMA,
      jobId: descriptor.jobId,
      campaignId: campaign.campaignId,
      campaignDigest,
      role: descriptor.role,
      sessionId: descriptor.sessionId,
      executor,
      dependencies: structuredClone(dependencies),
      deployment: campaign.deployment,
      notBefore: campaign.frozenAt,
      expiresAt: campaign.expiresAt,
      promptBase64: promptBytes.toString('base64'),
      promptSha256: sha256Text(promptBytes),
      outputSchema: descriptor.outputSchema || null,
      task: structuredClone(descriptor.task || null),
      descriptorSha256,
      idempotencyKey: digest({
        campaignId: campaign.campaignId,
        jobId: descriptor.jobId,
        descriptorSha256,
      }),
      modelRuntime: executor === 'model_no_tools'
        ? structuredClone(campaign.modelRuntime)
        : null,
      limits: {
        timeoutSeconds: descriptor.timeoutSeconds || 600,
        maxOutputBytes: descriptor.maxOutputBytes || 4 * 1024 * 1024,
      },
      canonicalStateAuthority: false,
      truthBoundary: 'Detached worker may produce candidate evidence only; it cannot grade, sign, or mutate canonical state.',
    }, signingSecret);
  });
  if (new Set(jobs.map((job) => job.jobId)).size !== jobs.length
      || new Set(jobs.map((job) => job.sessionId)).size !== jobs.length
      || new Set(jobs.map((job) => job.jobId.replace(/[^A-Za-z0-9-]/g, '-'))).size
        !== jobs.length
      || hasDependencyCycle(jobs)
      || jobs.some((job) => job.dependencies.some((dependency) => (
        dependency === job.jobId || !jobs.some((candidate) => candidate.jobId === dependency)
      )))) {
    throw new Error('detached qualification jobs reuse an identity/session or have an invalid dependency graph');
  }
  if (jobs.some((job) => {
    const proofTask = job.role === 'formal_research_theorem'
      ? job.task?.proofTask
      : job.task;
    return ['proof_candidate', 'formal_research_theorem'].includes(job.role)
      && !dependentResearchArtifactSourceMatchesPlan(proofTask, jobs);
  })) {
    throw new Error('dependent proof source differs from the exact planned research job');
  }
  if (!Array.isArray(protectedAuthorityTasks)
      || protectedAuthorityTasks.some((task) => (
        !ID.test(String(task?.taskId || ''))
        || !ID.test(String(task?.sessionId || ''))
        || !Array.isArray(task?.dependsOn)
        || new Set(task.dependsOn).size !== task.dependsOn.length
        || task.dependsOn.some((dependency) => !jobs.some((job) => job.jobId === dependency))
      ))
      || new Set(protectedAuthorityTasks.map((task) => task.taskId)).size
        !== protectedAuthorityTasks.length
      || new Set(protectedAuthorityTasks.map((task) => task.sessionId)).size
        !== protectedAuthorityTasks.length) {
    throw new Error('protected authority task plan is invalid');
  }
  if (campaign.fixtureOnly !== true) {
    const researchMainErrors = productionResearchMainPlanErrors({
      campaignId: campaign.campaignId,
      jobs,
      protectedAuthorityTasks,
    });
    if (researchMainErrors.length > 0) {
      throw new Error(researchMainErrors.join('; '));
    }
  }
  return sign({
    schemaVersion: PHD_DETACHED_JOB_PLAN_SCHEMA,
    campaignId: campaign.campaignId,
    subjectId: campaign.subjectId,
    campaignDigest,
    deployment: campaign.deployment,
    frozenAt: campaign.frozenAt,
    expiresAt: campaign.expiresAt,
    jobs,
    descriptorSetSha256: digest(jobs.map((job) => ({
      jobId: job.jobId,
      descriptorSha256: job.descriptorSha256,
      idempotencyKey: job.idempotencyKey,
    }))),
    protectedAuthorityTasks: structuredClone(protectedAuthorityTasks),
    resumePolicy: {
      idempotentByJobIdAndDescriptorDigest: true,
      idempotentByJobIdAndPromptDigest: true,
      terminalArtifactsImmutable: true,
      retryIdentityField: 'idempotencyKey',
      crashRecovery: 'rerun_missing_jobs_only_then_reharvest',
      partialApplyAllowed: false,
    },
    truthBoundary: 'A job plan is not qualification evidence.',
  }, signingSecret);
}

function detachedJobErrors(job, plan, signingSecret) {
  const errors = [];
  const jobKeys = [
    'schemaVersion', 'jobId', 'campaignId', 'campaignDigest', 'role', 'sessionId',
    'executor', 'dependencies', 'deployment', 'notBefore', 'expiresAt', 'promptBase64',
    'promptSha256', 'outputSchema', 'task', 'descriptorSha256', 'idempotencyKey',
    'modelRuntime', 'limits', 'canonicalStateAuthority', 'truthBoundary',
    'controlPlaneSignature',
  ];
  if (!verifySignature(job, signingSecret)) {
    errors.push('detached job signature mismatch');
    return errors;
  }
  if (!exactKeys(job, jobKeys) || job.schemaVersion !== PHD_DETACHED_JOB_SCHEMA) {
    errors.push('detached job schema or fields are invalid');
  }
  if (!exactKeys(job.controlPlaneSignature, ['algorithm', 'keyId', 'digest'])) {
    errors.push('detached job signature fields are invalid');
  }
  const deployment = validateDeploymentBinding(job.deployment);
  if (!deployment.ok) errors.push(`detached job deployment is invalid: ${deployment.errors.join('; ')}`);
  if (!isFrozenDeploymentBinding(job.deployment)) {
    errors.push('detached job execution closure is not frozen');
  }
  if (job.campaignId !== plan.campaignId
      || job.campaignDigest !== plan.campaignDigest
      || job.notBefore !== plan.frozenAt
      || job.expiresAt !== plan.expiresAt
      || canonicalJson(job.deployment) !== canonicalJson(plan.deployment)) {
    errors.push('detached job campaign or deployment binding mismatch');
  }
  const executor = job?.executor;
  const dependencies = job?.dependencies;
  if (!ID.test(String(job.jobId || ''))
      || !ID.test(String(job.sessionId || ''))
      || !Number.isFinite(Date.parse(String(job.notBefore || '')))
      || new Date(Date.parse(job.notBefore)).toISOString() !== job.notBefore
      || Date.parse(job.expiresAt) <= Date.parse(job.notBefore)
      || !['exam', 'proof_candidate', 'research_candidate', 'adversarial_review',
        'reproduction', 'formal_research_theorem', 'research_review_request',
        'retention'].includes(job.role)
      || !['model_no_tools', 'frozen_task_materialization',
        'authority_request_materialization', 'frozen_research_reproduction'].includes(executor)
      || (job.role === 'formal_research_theorem'
        && executor !== 'frozen_task_materialization')
      || (job.role === 'research_review_request'
        && executor !== 'authority_request_materialization')
      || (executor === 'frozen_task_materialization'
        && job.role !== 'formal_research_theorem')
      || (executor === 'authority_request_materialization'
        && job.role !== 'research_review_request')
      || (executor === 'frozen_research_reproduction' && job.role !== 'reproduction')
      || !Array.isArray(dependencies)
      || new Set(dependencies || []).size !== dependencies?.length
      || dependencies?.some((dependency) => (
        !ID.test(String(dependency || '')) || dependency === job.jobId
      ))
      || job.canonicalStateAuthority !== false
      || typeof job.truthBoundary !== 'string' || job.truthBoundary.length < 20) {
    errors.push('detached job identity, role, dependency, or authority is invalid');
  }
  if (executor === 'model_no_tools' && (
    !exactKeys(job.modelRuntime, ['provider', 'model', 'thinking', 'sandbox', 'toolsAllowed'])
      || job.modelRuntime?.provider !== 'openai-codex'
      || job.modelRuntime?.thinking !== 'xhigh'
      || job.modelRuntime?.sandbox !== 'read-only'
      || job.modelRuntime?.toolsAllowed !== false
      || typeof job.modelRuntime?.model !== 'string' || job.modelRuntime.model.length < 1
      || !/^[A-Za-z0-9._-]+[.]schema[.]json$/.test(String(job.outputSchema || ''))
      || (job.task !== null && !isRecord(job.task))
      || (job.deployment?.executionClosure?.immutable === true
        && job.deployment?.schemaVersion
          !== APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA)
  )) {
    errors.push('detached job model runtime is invalid');
  }
  if (executor !== 'model_no_tools'
      && (job.modelRuntime !== null || job.outputSchema !== null || !isRecord(job.task))) {
    errors.push('detached inert job runtime or structured task is invalid');
  }
  if (executor === 'authority_request_materialization'
      && (!validateResearchReviewRequestTask(job.task)
        || job.task.campaignId !== job.campaignId
        || job.task.candidateJobId !== job.dependencies?.[0])) {
    errors.push('detached research review request task scope is invalid');
  }
  const production = plan?.deployment?.schemaVersion
    === APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA;
  if ((job.role === 'proof_candidate'
        && !validProofDescriptorTask(job.task, dependencies, {
          production,
          campaignId: plan?.campaignId,
        }))
      || (job.role === 'formal_research_theorem'
        && !validFormalResearchMaterializationTask(job.task, dependencies, {
          production,
          campaignId: plan?.campaignId,
        }))) {
    errors.push('detached proof task or research materialization scope is invalid');
  }
  if (!exactKeys(job.limits, ['timeoutSeconds', 'maxOutputBytes'])
      || !Number.isInteger(job.limits?.timeoutSeconds)
      || job.limits.timeoutSeconds < 30 || job.limits.timeoutSeconds > 3600
      || !Number.isInteger(job.limits?.maxOutputBytes)
      || job.limits.maxOutputBytes < 1024 || job.limits.maxOutputBytes > 16 * 1024 * 1024) {
    errors.push('detached job limits are invalid');
  }
  const promptBytes = typeof job.promptBase64 === 'string'
    ? Buffer.from(job.promptBase64, 'base64')
    : Buffer.alloc(0);
  if (promptBytes.length < 1 || promptBytes.length > 1024 * 1024
      || promptBytes.toString('base64') !== job.promptBase64
      || sha256Text(promptBytes) !== job.promptSha256) {
    errors.push('detached job exact prompt bytes mismatch');
  }
  const expectedDescriptorSha256 = digest({
    jobId: job?.jobId,
    role: job?.role,
    sessionId: job?.sessionId,
    executor,
    dependencies,
    promptBase64: job?.promptBase64,
    outputSchema: job?.outputSchema || null,
    task: job?.task || null,
    timeoutSeconds: job?.limits?.timeoutSeconds,
    maxOutputBytes: job?.limits?.maxOutputBytes,
  });
  const expectedIdempotencyKey = digest({
    campaignId: job?.campaignId,
    jobId: job?.jobId,
    descriptorSha256: expectedDescriptorSha256,
  });
  if (!DIGEST.test(String(job?.descriptorSha256 || ''))
      || !DIGEST.test(String(job?.idempotencyKey || ''))
      || job.descriptorSha256 !== expectedDescriptorSha256
      || job.idempotencyKey !== expectedIdempotencyKey) {
    errors.push('detached job descriptor or idempotency binding is invalid');
  }
  return errors;
}

export function verifyDetachedQualificationJobPlan(plan, signingSecret, {
  expectedCampaignId = null,
  expectedDeployment = null,
  now = new Date().toISOString(),
  authorization = 'launch',
} = {}) {
  const errors = [];
  if (!verifySignature(plan, signingSecret)) {
    return { ok: false, errors: ['detached qualification job plan signature mismatch'] };
  }
  const planKeys = [
    'schemaVersion', 'campaignId', 'subjectId', 'campaignDigest', 'deployment', 'frozenAt',
    'expiresAt', 'jobs', 'descriptorSetSha256', 'protectedAuthorityTasks',
    'resumePolicy', 'truthBoundary', 'controlPlaneSignature',
  ];
  if (!exactKeys(plan, planKeys) || plan.schemaVersion !== PHD_DETACHED_JOB_PLAN_SCHEMA) {
    errors.push('detached qualification job plan schema or fields are invalid');
  }
  if (!exactKeys(plan.controlPlaneSignature, ['algorithm', 'keyId', 'digest'])) {
    errors.push('detached qualification job plan signature fields are invalid');
  }
  const deployment = validateDeploymentBinding(plan.deployment);
  if (!deployment.ok) errors.push(`detached qualification job plan deployment is invalid: ${deployment.errors.join('; ')}`);
  if (!isFrozenDeploymentBinding(plan.deployment)) {
    errors.push('detached qualification job plan execution closure is not frozen');
  }
  if (!ID.test(String(plan.campaignId || ''))
      || !ID.test(String(plan.subjectId || ''))
      || !DIGEST.test(String(plan.campaignDigest || ''))) {
    errors.push('detached qualification job plan campaign identity is invalid');
  }
  if (expectedCampaignId !== null && plan.campaignId !== expectedCampaignId) {
    errors.push('detached qualification job plan campaign identity mismatch');
  }
  if (expectedDeployment !== null
      && canonicalJson(plan.deployment) !== canonicalJson(expectedDeployment)) {
    errors.push('detached qualification job plan deployment identity mismatch');
  }
  const frozenAtMs = Date.parse(String(plan.frozenAt || ''));
  const expiresAtMs = Date.parse(String(plan.expiresAt || ''));
  const nowMs = Date.parse(String(now || ''));
  if (!['launch', 'archival_harvest'].includes(authorization)) {
    errors.push('detached qualification job plan verification purpose is invalid');
  }
  if (!Number.isFinite(frozenAtMs) || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= frozenAtMs
      || expiresAtMs - frozenAtMs > 180 * 24 * 60 * 60 * 1000) {
    errors.push('detached qualification job plan time window is invalid');
  } else if (!Number.isFinite(nowMs)
      || new Date(nowMs).toISOString() !== now
      || nowMs < frozenAtMs
      || (authorization === 'launch' && nowMs > expiresAtMs)) {
    errors.push(authorization === 'launch'
      ? 'detached qualification job plan is not currently authorized for launch'
      : 'detached qualification job plan archival verification time is invalid');
  }
  if (!Array.isArray(plan.jobs) || plan.jobs.length < 1 || plan.jobs.length > 64) {
    errors.push('detached qualification job plan jobs are invalid');
  } else {
    for (const [index, job] of plan.jobs.entries()) {
      errors.push(...detachedJobErrors(job, plan, signingSecret)
        .map((error) => `job ${index + 1}: ${error}`));
    }
    if (new Set(plan.jobs.map((job) => job?.jobId)).size !== plan.jobs.length
        || new Set(plan.jobs.map((job) => job?.sessionId)).size !== plan.jobs.length
        || new Set(plan.jobs.map((job) => String(job?.jobId || '')
          .replace(/[^A-Za-z0-9-]/g, '-'))).size
          !== plan.jobs.length
        || hasDependencyCycle(plan.jobs)
        || plan.jobs.some((job) => (
          !Array.isArray(job?.dependencies)
          || job.dependencies.some((dependency) => (
            dependency === job.jobId
            || !plan.jobs.some((candidate) => candidate?.jobId === dependency)
          ))
        ))) {
      errors.push('detached qualification jobs reuse an identity/session or have an invalid dependency graph');
    }
    for (const [index, job] of plan.jobs.entries()) {
      const proofTask = job?.role === 'formal_research_theorem'
        ? job.task?.proofTask
        : job?.task;
      if (['proof_candidate', 'formal_research_theorem'].includes(job?.role)
          && !dependentResearchArtifactSourceMatchesPlan(proofTask, plan.jobs)) {
        errors.push(
          `job ${index + 1}: dependent proof source differs from the exact planned research job`,
        );
      }
    }
  }
  const expectedDescriptorSetSha256 = digest((Array.isArray(plan.jobs) ? plan.jobs : [])
    .map((job) => ({
      jobId: job?.jobId,
      descriptorSha256: job?.descriptorSha256,
      idempotencyKey: job?.idempotencyKey,
    })));
  if (!DIGEST.test(String(plan.descriptorSetSha256 || ''))
      || plan.descriptorSetSha256 !== expectedDescriptorSetSha256) {
    errors.push('detached qualification descriptor set binding is invalid');
  }
  if (!Array.isArray(plan.protectedAuthorityTasks)
      || plan.protectedAuthorityTasks.some((task) => (
        !ID.test(String(task?.taskId || ''))
        || !ID.test(String(task?.sessionId || ''))
        || !Array.isArray(task?.dependsOn)
        || new Set(task.dependsOn).size !== task.dependsOn.length
        || task.dependsOn.some((dependency) => (
          !plan.jobs?.some((job) => job?.jobId === dependency)
        ))
      ))
      || new Set(plan.protectedAuthorityTasks?.map((task) => task?.taskId)).size
        !== plan.protectedAuthorityTasks?.length
      || new Set(plan.protectedAuthorityTasks?.map((task) => task?.sessionId)).size
        !== plan.protectedAuthorityTasks?.length) {
    errors.push('detached qualification protected authority tasks are invalid');
  }
  if (plan.deployment?.schemaVersion
      === APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA
      && Array.isArray(plan.jobs) && Array.isArray(plan.protectedAuthorityTasks)) {
    errors.push(...productionResearchMainPlanErrors({
      campaignId: plan.campaignId,
      jobs: plan.jobs,
      protectedAuthorityTasks: plan.protectedAuthorityTasks,
    }));
  }
  if (!exactKeys(plan.resumePolicy, [
    'idempotentByJobIdAndDescriptorDigest', 'idempotentByJobIdAndPromptDigest',
    'terminalArtifactsImmutable', 'retryIdentityField', 'crashRecovery',
    'partialApplyAllowed',
  ])
      || plan.resumePolicy?.idempotentByJobIdAndDescriptorDigest !== true
      || plan.resumePolicy?.idempotentByJobIdAndPromptDigest !== true
      || plan.resumePolicy?.terminalArtifactsImmutable !== true
      || plan.resumePolicy?.retryIdentityField !== 'idempotencyKey'
      || plan.resumePolicy?.crashRecovery !== 'rerun_missing_jobs_only_then_reharvest'
      || plan.resumePolicy?.partialApplyAllowed !== false) {
    errors.push('detached qualification job plan resume policy is invalid');
  }
  if (typeof plan.truthBoundary !== 'string' || plan.truthBoundary.length < 20) {
    errors.push('detached qualification job plan truth boundary is invalid');
  }
  return { ok: errors.length === 0, errors };
}

export function assertDetachedQualificationJobPlan(plan, signingSecret, options = {}) {
  const validation = verifyDetachedQualificationJobPlan(plan, signingSecret, options);
  if (!validation.ok) {
    throw new Error(`invalid detached qualification job plan: ${validation.errors.join('; ')}`);
  }
  return plan;
}

export function verifyQualificationHarvestEvidence({
  plan,
  harvestState,
  artifactManifestBytesByJob,
  artifactFileBytesByJob = null,
  campaign = null,
  signingSecret,
  now = new Date().toISOString(),
  requireArtifactManifests = true,
  requireArtifactFiles = false,
} = {}) {
  if (campaign !== null) assertCampaignFixtureOnly(campaign);
  const errors = [];
  const planValidation = verifyDetachedQualificationJobPlan(plan, signingSecret, {
    expectedCampaignId: campaign?.campaignId || null,
    expectedDeployment: campaign?.deployment || null,
    now,
    authorization: 'archival_harvest',
  });
  errors.push(...planValidation.errors.map((error) => `harvest plan: ${error}`));
  const planDigest = isRecord(plan) ? digest(plan) : null;
  const jobIds = Array.isArray(plan?.jobs) ? plan.jobs.map((job) => job?.jobId) : [];
  const jobSetSha256 = digest(jobIds);
  const stateKeys = [
    'schemaVersion', 'status', 'planDigest', 'subjectId', 'campaignId', 'campaignDigest',
    'deploymentDigest', 'descriptorSetSha256', 'jobSetSha256', 'productTree',
    'runtimeSha256', 'closureSha256', 'liveWorkerSetSha256',
    'expectedJobCount', 'observedJobCount',
    'succeededJobCount', 'failedJobCount', 'failures', 'jobReceipts',
    'planSnapshotPath', 'qualificationSecretPath', 'artifactRoot',
    'canonicalStateMutated', 'updatedAt', 'truthBoundary',
    'controlPlaneSignature',
  ];
  if (!exactKeys(harvestState, stateKeys)
      || harvestState?.schemaVersion !== PHD_HARVEST_STATE_SCHEMA
      || !verifySignature(harvestState, signingSecret)) {
    return {
      ok: false,
      errors: [...errors, 'harvest state fields or control-plane signature mismatch'],
      binding: null,
      receiptsByJob: new Map(),
      manifestsByJob: new Map(),
      filesByJob: new Map(),
      modelCallsByJob: new Map(),
    };
  }
  const expectedCampaignDigest = campaign === null ? plan?.campaignDigest : digest(campaign);
  const expectedDeploymentDigest = (() => {
    try { return deploymentBindingDigest(plan?.deployment); } catch { return null; }
  })();
  const updatedAtMs = Date.parse(String(harvestState.updatedAt || ''));
  if (harvestState.status !== 'ready_for_independent_replay'
      || harvestState.planDigest !== planDigest
      || harvestState.subjectId !== plan?.subjectId
      || harvestState.campaignId !== plan?.campaignId
      || harvestState.campaignDigest !== plan?.campaignDigest
      || harvestState.campaignDigest !== expectedCampaignDigest
      || harvestState.deploymentDigest !== expectedDeploymentDigest
      || harvestState.descriptorSetSha256 !== plan?.descriptorSetSha256
      || harvestState.jobSetSha256 !== jobSetSha256
      || harvestState.productTree !== plan?.deployment?.productTree
      || harvestState.runtimeSha256 !== plan?.deployment?.runtimeSha256
      || harvestState.closureSha256 !== plan?.deployment?.closureSha256
      || !DIGEST.test(String(harvestState.liveWorkerSetSha256 || ''))
      || harvestState.expectedJobCount !== jobIds.length
      || harvestState.observedJobCount !== jobIds.length
      || harvestState.succeededJobCount !== jobIds.length
      || harvestState.failedJobCount !== 0
      || !Array.isArray(harvestState.failures) || harvestState.failures.length !== 0
      || !Array.isArray(harvestState.jobReceipts)
      || harvestState.jobReceipts.length !== jobIds.length
      || harvestState.canonicalStateMutated !== false
      || !Number.isFinite(updatedAtMs)
      || updatedAtMs > Date.parse(now)
      || !/^\/[A-Za-z0-9._/-]+$/.test(String(harvestState.planSnapshotPath || ''))
      || !/^\/[A-Za-z0-9._/-]+$/.test(String(harvestState.qualificationSecretPath || ''))
      || !/^\/[A-Za-z0-9._/-]+$/.test(String(harvestState.artifactRoot || ''))) {
    errors.push('harvest state exact plan, campaign, deployment, closure, count, or terminal status mismatch');
  }
  const receiptKeys = [
    'schemaVersion', 'jobId', 'campaignId', 'jobDigest', 'descriptorSha256',
    'executor', 'executionIdentity', 'notBefore', 'startedAt', 'completedAt', 'expiresAt',
    'executionIntervalSha256', 'artifactManifestSha256', 'status',
    'providerTimeAuthority', 'canonicalStateAuthority', 'truthBoundary',
    'controlPlaneSignature',
  ];
  const receiptsByJob = new Map();
  const manifestsByJob = new Map();
  const filesByJob = new Map();
  const modelCallsByJob = new Map();
  let retainedArtifactBytes = 0;
  for (const receipt of harvestState.jobReceipts) {
    if (!exactKeys(receipt, receiptKeys)
        || receipt.schemaVersion !== PHD_HARVEST_RECEIPT_SCHEMA
        || !verifySignature(receipt, signingSecret)
        || receiptsByJob.has(receipt.jobId)) {
      errors.push('harvest receipt fields, signature, or uniqueness mismatch');
      continue;
    }
    receiptsByJob.set(receipt.jobId, receipt);
    const job = plan?.jobs?.find((candidate) => candidate?.jobId === receipt.jobId);
    const interval = {
      jobDigest: receipt.jobDigest,
      notBefore: receipt.notBefore,
      startedAt: receipt.startedAt,
      completedAt: receipt.completedAt,
      expiresAt: receipt.expiresAt,
    };
    const executionIdentity = {
      planDigest,
      campaignDigest: plan?.campaignDigest,
      descriptorSetSha256: plan?.descriptorSetSha256,
      productTree: plan?.deployment?.productTree,
      runtimeSha256: plan?.deployment?.runtimeSha256,
      closureSha256: plan?.deployment?.closureSha256,
    };
    if (!job
        || receipt.campaignId !== plan.campaignId
        || receipt.jobDigest !== digest(job)
        || receipt.descriptorSha256 !== job.descriptorSha256
        || receipt.executor !== job.executor
        || canonicalJson(receipt.executionIdentity) !== canonicalJson(executionIdentity)
        || receipt.notBefore !== job.notBefore
        || receipt.expiresAt !== job.expiresAt
        || !Number.isFinite(Date.parse(receipt.startedAt))
        || !Number.isFinite(Date.parse(receipt.completedAt))
        || Date.parse(receipt.startedAt) < Date.parse(receipt.notBefore)
        || Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)
        || Date.parse(receipt.completedAt) > Date.parse(receipt.expiresAt)
        || receipt.executionIntervalSha256 !== digest(interval)
        || !DIGEST.test(String(receipt.artifactManifestSha256 || ''))
        || receipt.status !== 'candidate_authenticated_for_independent_replay'
        || receipt.providerTimeAuthority !== false
        || receipt.canonicalStateAuthority !== false) {
      errors.push(`harvest receipt exact job, interval, or execution identity mismatch: ${String(receipt.jobId || '')}`);
      continue;
    }
    if (requireArtifactManifests) {
      const encoded = artifactManifestBytesByJob?.[receipt.jobId];
      let manifestBytes = null;
      let manifest = null;
      try {
        manifestBytes = Buffer.from(encoded || '', 'base64');
        if (!encoded || manifestBytes.toString('base64') !== encoded
            || sha256Bytes(manifestBytes) !== receipt.artifactManifestSha256) {
          throw new Error('manifest bytes digest mismatch');
        }
        manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
        manifestsByJob.set(receipt.jobId, manifest);
      } catch (error) {
        errors.push(`harvest artifact manifest bytes are missing or invalid: ${receipt.jobId}: ${error.message}`);
        continue;
      }
      const manifestFilePaths = Array.isArray(manifest?.files)
        ? manifest.files.map((file) => file?.path)
        : [];
      const outputFile = Array.isArray(manifest?.files)
        ? manifest.files.find((file) => file?.path === 'output.json')
        : null;
      if (!exactKeys(manifest, [
        'schemaVersion', 'jobId', 'campaignId', 'jobDigest',
        'jobControlPlaneSignature', 'deployment', 'executor', 'executionIdentity',
        'promptSha256', 'status', 'notBefore', 'startedAt', 'completedAt', 'expiresAt',
        'executionIntervalSha256', 'timingProvenance', 'outputSha256',
        'publication', 'directories', 'files', 'authority', 'truthBoundary',
      ])
          || manifest?.schemaVersion !== 'cortex.learning_os.phd_worker_manifest.v3'
          || manifest.jobId !== job.jobId
          || manifest.campaignId !== job.campaignId
          || manifest.jobDigest !== receipt.jobDigest
          || canonicalJson(manifest.jobControlPlaneSignature)
            !== canonicalJson(job.controlPlaneSignature)
          || canonicalJson(manifest.deployment) !== canonicalJson(job.deployment)
          || manifest.executor !== job.executor
          || canonicalJson(manifest.executionIdentity)
            !== canonicalJson(receipt.executionIdentity)
          || manifest.promptSha256 !== job.promptSha256
          || manifest.notBefore !== receipt.notBefore
          || manifest.startedAt !== receipt.startedAt
          || manifest.completedAt !== receipt.completedAt
          || manifest.expiresAt !== receipt.expiresAt
          || manifest.executionIntervalSha256 !== receipt.executionIntervalSha256
          || manifest.status !== 'candidate'
          || manifest.timingProvenance !== 'worker_observed_awaiting_execution_attestation'
          || !DIGEST.test(String(manifest.outputSha256 || ''))
          || !Array.isArray(manifest.files)
          || manifest.files.length < 1
          || new Set(manifestFilePaths).size !== manifestFilePaths.length
          || manifest.files.some((file) => (
            !exactKeys(file, [
              'bytes', 'path', 'ownerUid', 'ownerGid', 'mode', 'linkCount', 'sha256',
            ])
            || typeof file.path !== 'string'
            || file.path.length < 1
            || path.posix.isAbsolute(file.path)
            || file.path.split('/').includes('..')
            || !Number.isSafeInteger(file.bytes)
            || file.bytes < 0
            || file.ownerUid !== 0
            || file.ownerGid !== 0
            || file.mode !== '0444'
            || file.linkCount !== 1
            || !DIGEST.test(String(file.sha256 || ''))
          ))
          || !exactKeys(manifest.publication, [
            'schemaVersion', 'publisherUid', 'publisherGid', 'rootMode', 'fileMode',
            'directoryMode', 'regularFileLinkCount', 'rootLinkCount',
            'producerWritableTerminal', 'noFollow', 'exactMetadata',
          ])
          || manifest.publication.schemaVersion
            !== 'cortex.learning_os.phd_terminal_publication.v1'
          || manifest.publication.publisherUid !== 0
          || manifest.publication.publisherGid !== 0
          || manifest.publication.rootMode !== '0555'
          || manifest.publication.fileMode !== '0444'
          || manifest.publication.directoryMode !== '0555'
          || manifest.publication.regularFileLinkCount !== 1
          || !Number.isSafeInteger(manifest.publication.rootLinkCount)
          || manifest.publication.rootLinkCount < 2
          || manifest.publication.producerWritableTerminal !== false
          || manifest.publication.noFollow !== true
          || manifest.publication.exactMetadata !== true
          || !Array.isArray(manifest.directories)
          || new Set(manifest.directories.map((entry) => entry?.path)).size
            !== manifest.directories.length
          || manifest.directories.some((entry) => (
            !exactKeys(entry, ['path', 'ownerUid', 'ownerGid', 'mode', 'linkCount'])
            || typeof entry.path !== 'string' || entry.path.length < 1
            || path.posix.isAbsolute(entry.path)
            || entry.path.split('/').includes('..')
            || entry.ownerUid !== 0 || entry.ownerGid !== 0
            || entry.mode !== '0555'
            || !Number.isSafeInteger(entry.linkCount) || entry.linkCount < 2
          ))
          || outputFile?.sha256 !== manifest.outputSha256
          || manifest.authority !== 'worker_evidence_only'
          || manifest.truthBoundary
            !== 'Remote worker artifacts cannot mutate or qualify canonical control-plane state.') {
        errors.push(`harvest artifact manifest identity mismatch: ${receipt.jobId}`);
      }
      if (requireArtifactFiles) {
        const encodedFiles = artifactFileBytesByJob?.[receipt.jobId];
        const expectedPaths = manifest.files.map((file) => file.path).sort();
        if (!isRecord(encodedFiles)
            || canonicalJson(Object.keys(encodedFiles).sort()) !== canonicalJson(expectedPaths)) {
          errors.push(`harvest exact artifact file set is partial or injected: ${receipt.jobId}`);
          continue;
        }
        const exactFiles = new Map();
        for (const file of manifest.files) {
          const encodedFile = encodedFiles[file.path];
          const bytes = typeof encodedFile === 'string'
            ? Buffer.from(encodedFile, 'base64')
            : Buffer.alloc(0);
          retainedArtifactBytes += bytes.length;
          if (typeof encodedFile !== 'string'
              || bytes.toString('base64') !== encodedFile
              || bytes.length !== file.bytes
              || sha256Bytes(bytes) !== file.sha256
              || retainedArtifactBytes > 256 * 1024 * 1024) {
            errors.push(`harvest exact artifact file bytes mismatch: ${receipt.jobId}:${file.path}`);
            continue;
          }
          exactFiles.set(file.path, bytes);
        }
        filesByJob.set(receipt.jobId, exactFiles);
        if (job.executor === 'model_no_tools') {
          let call = null;
          try {
            const callBytes = exactFiles.get('model-call.json');
            if (!callBytes) throw new Error('model-call.json is absent');
            call = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(callBytes));
          } catch (error) {
            errors.push(`harvest exact model-call bytes are missing or invalid: ${receipt.jobId}: ${error.message}`);
            continue;
          }
          const terminal = validatePhdModelCallTerminal({
            job,
            call,
            jobDigest: receipt.jobDigest,
            executionIdentity: receipt.executionIdentity,
            startedAt: receipt.startedAt,
            completedAt: receipt.completedAt,
            executionIntervalSha256: receipt.executionIntervalSha256,
            outputBytes: exactFiles.get('output.json') || Buffer.alloc(0),
            rawEventLedgerBytes: exactFiles.get('raw-events.ndjson') || Buffer.alloc(0),
            rawStderrBytes: exactFiles.get('stderr.raw') || Buffer.alloc(0),
          });
          if (!terminal.ok || call.outputSha256 !== manifest.outputSha256) {
            errors.push(`harvest exact model-call contract mismatch: ${receipt.jobId}: ${terminal.errors.join('; ')}`);
            continue;
          }
          modelCallsByJob.set(receipt.jobId, call);
        }
      }
    }
  }
  if (receiptsByJob.size !== jobIds.length
      || jobIds.some((jobId) => !receiptsByJob.has(jobId))
      || (requireArtifactManifests
        && (!isRecord(artifactManifestBytesByJob)
          || canonicalJson(Object.keys(artifactManifestBytesByJob).sort())
            !== canonicalJson([...jobIds].sort())))
      || (requireArtifactFiles
        && (!isRecord(artifactFileBytesByJob)
          || canonicalJson(Object.keys(artifactFileBytesByJob).sort())
            !== canonicalJson([...jobIds].sort())
          || filesByJob.size !== jobIds.length))
      || (requireArtifactFiles
        && plan?.jobs?.filter((job) => job?.executor === 'model_no_tools')
          .some((job) => !modelCallsByJob.has(job.jobId)))) {
    errors.push('harvest receipt or artifact-manifest set is partial, duplicate, stale, injected, missing, or extra');
  }
  const artifactSetSha256 = requireArtifactFiles
    ? digest(jobIds.map((jobId) => {
      const manifest = manifestsByJob.get(jobId);
      return {
        jobId,
        manifestSha256: receiptsByJob.get(jobId)?.artifactManifestSha256 ?? null,
        publication: manifest?.publication ?? null,
        directories: manifest?.directories ?? null,
        files: (manifest?.files || []).map((file) => ({
          path: file.path ?? null,
          bytes: file.bytes ?? null,
          ownerUid: file.ownerUid ?? null,
          ownerGid: file.ownerGid ?? null,
          mode: file.mode ?? null,
          linkCount: file.linkCount ?? null,
          sha256: file.sha256 ?? null,
        })),
      };
    }))
    : null;
  const binding = {
    planDigest: planDigest ?? null,
    harvestStateDigest: isRecord(harvestState) ? digest(harvestState) : null,
    campaignDigest: plan?.campaignDigest ?? null,
    deploymentDigest: expectedDeploymentDigest ?? null,
    descriptorSetSha256: plan?.descriptorSetSha256 ?? null,
    jobSetSha256: jobSetSha256 ?? null,
    jobCount: jobIds.length,
    receiptSetSha256: digest(jobIds.map((jobId) => {
      const receipt = receiptsByJob.get(jobId);
      return isRecord(receipt) ? digest(receipt) : null;
    })),
    artifactSetSha256,
    modelCallSetSha256: requireArtifactFiles
      ? digest(plan?.jobs?.filter((job) => job?.executor === 'model_no_tools')
        .map((job) => ({
          jobId: job.jobId,
          executionEvidenceSha256:
            modelCallsByJob.get(job.jobId)?.executionEvidenceSha256 ?? null,
        })) || [])
      : null,
  };
  return {
    ok: errors.length === 0,
    errors,
    binding,
    receiptsByJob,
    manifestsByJob,
    filesByJob,
    modelCallsByJob,
  };
}

export function validateProofRuntimeReplayChain({
  kernelEvidence,
  replayReceipt,
  trustPolicy,
  expectedDeployment,
} = {}) {
  const errors = [];
  let replayRequest = null;
  try {
    const parsed = parseProofReplayRequestBytes(
      Buffer.from(replayReceipt?.requestBytesBase64 || '', 'base64'),
    );
    replayRequest = parsed.request;
    if (parsed.bytes.toString('base64') !== replayReceipt?.requestBytesBase64
        || parsed.requestSha256 !== replayReceipt?.requestSha256
        || replayRequest.obligationId !== replayReceipt?.obligationId
        || replayRequest.replaySessionId !== replayReceipt?.replaySessionId
        || replayRequest.taskBytesSha256 !== replayReceipt?.taskBytesSha256
        || replayRequest.candidateBytesSha256 !== replayReceipt?.candidateBytesSha256
        || replayRequest.trustedTemplateSha256 !== replayReceipt?.templateSha256
        || replayRequest.theoremStatementSha256
          !== kernelEvidence?.bindings?.theoremStatementSha256
        || replayRequest.claimSemanticsSha256
          !== (replayReceipt?.claimSemanticsSha256 ?? null)
        || replayRequest.researchArtifactDigest
          !== (replayReceipt?.researchArtifactDigest ?? null)
        || replayRequest.deploymentDigest !== deploymentBindingDigest(expectedDeployment)
        || replayRequest.trustPolicyDigest !== digest(trustPolicy)
        || replayRequest.proofRuntimeProductDigest
          !== expectedDeployment?.contentDigests?.['proof-runtime-product']) {
      throw new Error('request identity mismatch');
    }
  } catch (error) {
    errors.push(`proof replay exact request is invalid: ${error.message}`);
  }
  if (!exactKeys(replayReceipt, PROOF_REPLAY_RECEIPT_KEYS)) {
    errors.push('proof replay receipt fields are incomplete or unknown');
  }
  if (replayReceipt?.schemaVersion !== PROOF_REPLAY_RECEIPT_SCHEMA
      || replayReceipt?.verified !== true
      || replayReceipt?.truthBoundary
        !== 'This signed receipt attests exact independent pinned-Lean replay only.') {
    errors.push('proof replay receipt schema, verdict, or truth boundary is invalid');
  }
  const trustValidation = validatePhdTrustPolicy(trustPolicy, { requireProduction: true });
  if (!trustValidation.ok) {
    errors.push(...trustValidation.errors.map((error) => `proof trust policy: ${error}`));
  }
  const kernelValidation = validateKernelEvidence(kernelEvidence);
  if (!kernelValidation.ok) errors.push(...kernelValidation.errors);
  const replayEvidenceValidation = validateKernelEvidence(replayReceipt?.replayEvidence);
  if (!replayEvidenceValidation.ok) {
    errors.push(...replayEvidenceValidation.errors.map((error) => `replay evidence: ${error}`));
  }
  const kernelRuntime = kernelEvidence?.kernel?.authenticatedRuntime;
  const replayRuntime = replayReceipt?.replayEvidence?.kernel?.authenticatedRuntime;
  const receiptRuntime = replayReceipt?.proofRuntime;
  for (const [label, runtime] of [
    ['kernel', kernelRuntime],
    ['replay', replayRuntime],
    ['receipt', receiptRuntime],
  ]) {
    const validation = validateProofRuntimeEvidence(runtime, {
      trustPolicy,
      expectedDeployment,
    });
    if (!validation.ok) {
      errors.push(...validation.errors.map((error) => `${label} proof runtime: ${error}`));
    }
  }
  if (canonicalJson(kernelRuntime) !== canonicalJson(replayRuntime)
      || canonicalJson(kernelRuntime) !== canonicalJson(receiptRuntime)) {
    errors.push('kernel, replay, and receipt do not carry the same exact proof runtime evidence');
  }
  for (const field of [
    'schemaVersion',
    'taskId',
    'candidateId',
    'conceptId',
    'bindings',
    'toolchain',
    'deployment',
    'runIdentity',
    'limits',
    'kernel',
    'command',
    'process',
    'output',
    'kernelAccepted',
    'truthBoundary',
  ]) {
    if (canonicalJson(kernelEvidence?.[field])
        !== canonicalJson(replayReceipt?.replayEvidence?.[field])) {
      errors.push(`independent replay evidence changed ${field}`);
    }
  }
  if (!isRecord(replayReceipt?.replayEvidence)
      || digest(replayReceipt.replayEvidence) !== replayReceipt?.replayEvidenceDigest) {
    errors.push('replay evidence digest does not authenticate the exact replay evidence');
  }
  if (!isRecord(kernelEvidence)
      || replayReceipt?.kernelEvidenceDigest !== digest(kernelEvidence)
      || replayReceipt?.taskBytesSha256 !== kernelEvidence?.bindings?.taskBytesSha256
      || replayReceipt?.candidateBytesSha256 !== kernelEvidence?.bindings?.candidateBytesSha256
      || replayReceipt?.templateSha256 !== kernelEvidence?.bindings?.templateSha256) {
    errors.push('replay receipt does not bind the exact kernel/task/candidate/template evidence');
  }
  if (!isRecord(kernelRuntime)
      || digest(kernelRuntime) !== replayReceipt?.proofRuntimeEvidenceDigest
      || replayReceipt?.proofRuntimeAttestationSha256 !== kernelRuntime?.attestationSha256
      || replayReceipt?.proofRuntimeIdentitySha256 !== kernelRuntime?.runtimeIdentitySha256
      || replayReceipt?.proofRuntimeAuthorityId !== kernelRuntime?.authorityId
      || replayReceipt?.proofRuntimeVerificationKeySha256
        !== kernelRuntime?.verificationKeySha256) {
    errors.push('replay receipt proof-runtime digest, identity, authority, or key binding mismatch');
  }
  if (replayReceipt?.replayAuthorityId
        !== replayReceipt?.replayAuthorityAttestation?.authorityId
      || replayReceipt?.replayVerificationKeySha256
        !== replayReceipt?.replayAuthorityAttestation?.signature?.keyId) {
    errors.push('replay receipt authority or verification-key identity mismatch');
  }
  const replayAttestationPayload = {
    obligationId: replayReceipt?.obligationId,
    requestSha256: replayReceipt?.requestSha256,
    originalEvidenceDigest: isRecord(kernelEvidence) ? digest(kernelEvidence) : null,
    replayEvidenceDigest: replayReceipt?.replayEvidenceDigest,
    taskBytesSha256: kernelEvidence?.bindings?.taskBytesSha256,
    candidateBytesSha256: kernelEvidence?.bindings?.candidateBytesSha256,
    templateSha256: kernelEvidence?.bindings?.templateSha256,
    replaySessionId: replayReceipt?.replaySessionId,
    claimSemanticsSha256: replayReceipt?.claimSemanticsSha256 ?? null,
    researchArtifactDigest: replayReceipt?.researchArtifactDigest ?? null,
    proofRuntimeEvidenceDigest: replayReceipt?.proofRuntimeEvidenceDigest,
    proofRuntimeAttestationSha256: replayReceipt?.proofRuntimeAttestationSha256,
    proofRuntimeIdentitySha256: replayReceipt?.proofRuntimeIdentitySha256,
    proofRuntimeAuthorityId: replayReceipt?.proofRuntimeAuthorityId,
    proofRuntimeVerificationKeySha256: replayReceipt?.proofRuntimeVerificationKeySha256,
  };
  if (!verifyAuthorityAttestation(replayReceipt?.replayAuthorityAttestation, {
    trustPolicy,
    capability: 'proof_replay',
  }) || canonicalJson(replayReceipt?.replayAuthorityAttestation?.payload)
      !== canonicalJson(replayAttestationPayload)) {
    errors.push('replay authority attestation does not authenticate the exact replay/runtime binding');
  }
  const independence = validateCapabilityAuthorityIndependence({
    trustPolicy,
    firstAttestation: kernelRuntime?.attestation,
    firstCapability: 'proof_runtime',
    secondAttestation: replayReceipt?.replayAuthorityAttestation,
    secondCapability: 'proof_replay',
    requireProduction: true,
  });
  if (!independence.ok) errors.push(...independence.errors);
  return { ok: errors.length === 0, errors };
}

export function assembleProofRun({
  campaign,
  qualificationPlan = null,
  harvestState = null,
  artifactManifestBytesByJob = null,
  artifactFileBytesByJob = null,
  harvestObservedAt = null,
  obligationId,
  taskBytes,
  candidateBytes,
  trustedTemplateBytes,
  candidateCall,
  candidateOutputBytes,
  candidateRawEventLedgerBytes = Buffer.alloc(0),
  candidateRawStderrBytes = Buffer.alloc(0),
  kernelEvidence,
  replayReceipt,
  signingSecret = null,
  researchArtifactDigest = null,
  researchClaimSemanticsSha256 = null,
} = {}) {
  assertCampaignFixtureOnly(campaign);
  const proofIndex = campaign?.proofObligationIds?.indexOf(obligationId);
  if (!Number.isInteger(proofIndex) || proofIndex < 0
      || candidateCall?.role !== 'proof_candidate'
      || !validWorkerExecutionIdentity(campaign, candidateCall)
      || (candidateCall.plannedSessionId || candidateCall.sessionId)
        !== campaign.roles.proofCandidateSessions[proofIndex]) {
    throw new Error('proof run role, obligation, or planned session is invalid');
  }
  const rawOutput = Buffer.isBuffer(candidateOutputBytes)
    ? candidateOutputBytes
    : Buffer.from(candidateOutputBytes || '');
  const qualificationHarvestBinding = productionHarvestBindingForWorker({
    campaign,
    qualificationPlan,
    harvestState,
    artifactManifestBytesByJob,
    artifactFileBytesByJob,
    signingSecret,
    harvestObservedAt,
    workerCall: candidateCall,
    expectedJobId: `${campaign.campaignId}.${obligationId}`,
    workerOutputBytes: rawOutput,
    workerRawEventLedgerBytes: candidateRawEventLedgerBytes,
    workerRawStderrBytes: candidateRawStderrBytes,
  });
  const taskEnvelope = parseProofRecordBytes(taskBytes, 'campaign proof task');
  const candidateEnvelope = parseProofRecordBytes(candidateBytes, 'campaign proof candidate');
  const taskValidation = validateProofTask(taskEnvelope.record);
  const candidateValidation = validateProofCandidate(candidateEnvelope.record, taskBytes);
  const authenticatedProofJob = campaign.fixtureOnly === true
    ? null
    : qualificationPlan?.jobs?.find((job) => (
      job?.jobId === `${campaign.campaignId}.${obligationId}`
      && job?.role === 'proof_candidate'
    ));
  const authenticatedProofTask = authenticatedProofJob?.task;
  const researchMainProof = obligationId === 'formal-proof-research-main-result';
  const dependentResearchProof = authenticatedProofTask?.schemaVersion
    === DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA;
  const authenticatedResearchJob = dependentResearchProof
    ? qualificationPlan?.jobs?.find((job) => (
      job?.jobId === authenticatedProofTask.researchArtifactSource.dependencyJobId
    ))
    : null;
  const materializationProofTask = researchMainProof && campaign.fixtureOnly !== true
    ? qualificationPlan?.jobs?.find((job) => (
      job?.jobId === `${campaign.campaignId}.formal-research-theorem`
        && job?.role === 'formal_research_theorem'
    ))?.task?.proofTask
    : null;
  let parsedOutput;
  try { parsedOutput = JSON.parse(rawOutput.toString('utf8')); } catch { parsedOutput = null; }
  if (!taskValidation.ok || !candidateValidation.ok
      || taskEnvelope.record.conceptId !== obligationId
      || canonicalJson(parsedOutput) !== canonicalJson({
        proofTerm: candidateEnvelope.record.proof.term,
      })
      || candidateCall.outputSha256 !== sha256Text(rawOutput)
      || kernelEvidence?.bindings?.taskBytesSha256 !== taskEnvelope.bytesSha256
      || kernelEvidence?.bindings?.candidateBytesSha256 !== candidateEnvelope.bytesSha256
      || kernelEvidence?.bindings?.templateSha256 !== sha256Text(trustedTemplateBytes)
      || (campaign.fixtureOnly !== true && (
        !validateProofCandidateJobTask(authenticatedProofTask).ok
        || authenticatedProofTask.obligationId !== obligationId
        || authenticatedProofTask.taskBytesBase64 !== Buffer.from(taskBytes).toString('base64')
        || authenticatedProofTask.taskBytesSha256 !== taskEnvelope.bytesSha256
        || authenticatedProofTask.trustedTemplateBase64
          !== Buffer.from(trustedTemplateBytes).toString('base64')
        || authenticatedProofTask.trustedTemplateSha256
          !== sha256Text(trustedTemplateBytes)
        || candidateCall?.executionEvidenceCore?.bindings?.taskSha256
          !== digest(authenticatedProofTask)
        || (researchMainProof && (
          !dependentResearchProof
          || canonicalJson(materializationProofTask)
            !== canonicalJson(authenticatedProofTask)
        ))
        || (dependentResearchProof
          ? (authenticatedProofTask.researchArtifactDigest !== null
            || authenticatedProofJob.dependencies?.length !== 1
            || authenticatedProofJob.dependencies[0]
              !== authenticatedProofTask.researchArtifactSource.dependencyJobId
            || authenticatedProofTask.researchArtifactSource.dependencyJobId
              !== `${campaign.campaignId}.research_candidate`
            || authenticatedResearchJob?.role !== 'research_candidate'
            || authenticatedResearchJob?.sessionId
              !== authenticatedProofTask.researchArtifactSource.candidateSessionId
            || authenticatedResearchJob?.promptSha256
              !== authenticatedProofTask.researchArtifactSource.candidatePromptSha256
            || !DIGEST.test(String(researchArtifactDigest || '')))
          : authenticatedProofTask.researchArtifactDigest !== researchArtifactDigest)
      ))) {
    throw new Error('proof run raw output, record bytes, template, or kernel binding is invalid');
  }
  if (campaign.fixtureOnly !== true) {
    if (!verifySignature(replayReceipt, signingSecret)) {
      throw new Error('proof run replay receipt control-plane signature is invalid');
    }
    const replayRequest = parseProofReplayRequestBytes(
      Buffer.from(replayReceipt.requestBytesBase64 || '', 'base64'),
    ).request;
    if (replayRequest.proofTaskSha256 !== digest(authenticatedProofTask)) {
      throw new Error('proof run replay request differs from the exact authenticated proof task');
    }
    const runtimeChain = validateProofRuntimeReplayChain({
      kernelEvidence,
      replayReceipt,
      trustPolicy: campaign.trustPolicy,
      expectedDeployment: campaign.deployment,
    });
    if (!runtimeChain.ok) {
      throw new Error(`proof run runtime/replay trust chain is invalid: ${runtimeChain.errors.join('; ')}`);
    }
  }
  return {
    obligationId,
    candidateSessionId: candidateCall.plannedSessionId || candidateCall.sessionId,
    taskBytesBase64: Buffer.from(taskBytes).toString('base64'),
    candidateBytesBase64: Buffer.from(candidateBytes).toString('base64'),
    trustedTemplateBytesBase64: Buffer.from(trustedTemplateBytes).toString('base64'),
    candidateExecution: workerExecution(candidateCall, campaign, {
      exactTaskBytesSupplied: true,
      taskBytesSha256: taskEnvelope.bytesSha256,
      candidateBytesSha256: candidateEnvelope.bytesSha256,
      rawOutputBase64: rawOutput.toString('base64'),
      rawEventLedgerBase64: Buffer.from(candidateRawEventLedgerBytes).toString('base64'),
      rawStderrBase64: Buffer.from(candidateRawStderrBytes).toString('base64'),
    }),
    qualificationHarvestBinding: structuredClone(qualificationHarvestBinding),
    kernelEvidence: structuredClone(kernelEvidence),
    replayReceipt: structuredClone(replayReceipt),
    researchArtifactDigest,
    researchClaimSemanticsSha256,
  };
}

export async function createProofReplayReceipt({
  campaign = null,
  qualificationPlan = null,
  harvestState = null,
  artifactManifestBytesByJob = null,
  artifactFileBytesByJob = null,
  harvestObservedAt = null,
  obligationId,
  kernelEvidence,
  taskBytes,
  candidateBytes,
  trustedTemplateBytes,
  expectedDeployment,
  replaySessionId,
  replayRequestBytes,
  authorityReplayEvidence = null,
  replayAuthorityAttestation = null,
  trustPolicy = null,
  fixtureOnly = false,
  claimSemanticsSha256 = null,
  researchArtifactDigest = null,
  signingSecret,
  proofKernelRoot,
} = {}) {
  assertFixtureOnlyBoolean(fixtureOnly, 'proof replay fixtureOnly');
  if (campaign !== null) {
    assertCampaignFixtureOnly(campaign);
    if (campaign.fixtureOnly !== fixtureOnly) {
      throw new Error('proof replay fixtureOnly must match the campaign');
    }
  }
  const parsedRequest = parseProofReplayRequestBytes(replayRequestBytes);
  const request = parsedRequest.request;
  const authenticatedProofJob = campaign?.fixtureOnly === false
    ? qualificationPlan?.jobs?.find((job) => (
      job?.jobId === `${campaign.campaignId}.${obligationId}`
        && job?.role === 'proof_candidate'
    ))
    : null;
  if (campaign?.fixtureOnly === false) {
    if (!canonicalTimestamp(harvestObservedAt)) {
      throw new Error('proof replay requires an explicit post-harvest observation timestamp');
    }
    const harvest = verifyQualificationHarvestEvidence({
      plan: qualificationPlan,
      harvestState,
      artifactManifestBytesByJob,
      artifactFileBytesByJob,
      campaign,
      signingSecret,
      now: harvestObservedAt,
      requireArtifactManifests: true,
      requireArtifactFiles: true,
    });
    const requestFile = harvest.filesByJob
      .get(`${campaign.campaignId}.${obligationId}`)
      ?.get('independent-replay-request.json');
    if (!harvest.ok
        || !requestFile
        || !requestFile.equals(parsedRequest.bytes)
        || sha256Bytes(requestFile) !== parsedRequest.requestSha256) {
      throw new Error('proof replay request bytes are not the exact authenticated worker emission');
    }
  }
  if (request.obligationId !== obligationId
      || (campaign !== null && (
        request.campaignId !== campaign.campaignId
        || request.jobId !== `${campaign.campaignId}.${obligationId}`
        || request.trustPolicyDigest !== campaign.trustPolicyDigest
      ))
      || request.replaySessionId !== replaySessionId
      || request.taskBytesBase64 !== Buffer.from(taskBytes).toString('base64')
      || request.candidateBytesBase64 !== Buffer.from(candidateBytes).toString('base64')
      || request.trustedTemplateBase64 !== Buffer.from(trustedTemplateBytes).toString('base64')
      || request.deploymentDigest !== deploymentBindingDigest(expectedDeployment)
      || request.trustPolicyDigest !== expectedDeployment?.contentDigests?.['trust-policy']
      || request.proofRuntimeProductDigest
        !== expectedDeployment?.contentDigests?.['proof-runtime-product']
      || (campaign?.fixtureOnly === false && (
        !validateProofCandidateJobTask(authenticatedProofJob?.task).ok
        || request.proofTaskSha256 !== digest(authenticatedProofJob.task)
        || request.taskBytesBase64 !== authenticatedProofJob.task.taskBytesBase64
        || request.trustedTemplateBase64
          !== authenticatedProofJob.task.trustedTemplateBase64
      ))
      || request.claimSemanticsSha256 !== claimSemanticsSha256
      || request.researchArtifactDigest !== researchArtifactDigest) {
    throw new Error('proof replay arguments differ from the exact emitted request');
  }
  const replayResult = await replayLeanProofEvidence({
    taskBytes,
    candidateBytes,
    trustedTemplateBytes,
    evidence: kernelEvidence,
    expectedDeployment,
    ...(proofKernelRoot ? { proofKernelRoot } : {}),
  });
  const validation = validateKernelEvidence(kernelEvidence);
  if (!validation.ok || kernelEvidence.kernelAccepted !== true
      || replayResult?.verified !== true
      || replayResult?.replayEvidence?.kernelAccepted !== true
      || replayResult?.originalEvidenceDigest !== digest(kernelEvidence)
      || !ID.test(String(replaySessionId || ''))) {
    throw new Error('cannot attest an invalid proof replay');
  }
  const proofRuntime = kernelEvidence.kernel.authenticatedRuntime;
  if (canonicalJson(proofRuntime)
      !== canonicalJson(replayResult.replayEvidence.kernel.authenticatedRuntime)) {
    throw new Error('proof replay used a different exact proof runtime');
  }
  let retainedReplayEvidence = replayResult.replayEvidence;
  let retainedReplayEvidenceDigest = replayResult.replayEvidenceDigest;
  if (!fixtureOnly) {
    const trustValidation = validatePhdTrustPolicy(trustPolicy, { requireProduction: true });
    if (!trustValidation.ok) {
      throw new Error(`proof replay production trust policy is invalid: ${trustValidation.errors.join('; ')}`);
    }
    for (const [label, runtime] of [
      ['kernel', proofRuntime],
      ['replay', replayResult.replayEvidence.kernel.authenticatedRuntime],
    ]) {
      const runtimeValidation = validateProofRuntimeEvidence(runtime, {
        trustPolicy,
        expectedDeployment,
      });
      if (!runtimeValidation.ok) {
        throw new Error(`${label} proof runtime evidence is invalid: ${runtimeValidation.errors.join('; ')}`);
      }
    }
    const authorityReplayValidation = validateKernelEvidence(authorityReplayEvidence);
    const authorityReplayIdentity = validateReplayEvidenceIdentity(
      kernelEvidence,
      authorityReplayEvidence,
    );
    if (!authorityReplayValidation.ok
        || authorityReplayEvidence?.kernelAccepted !== true
        || !authorityReplayIdentity.ok) {
      throw new Error(`protected authority replay evidence is invalid: ${[
        ...authorityReplayValidation.errors,
        ...authorityReplayIdentity.errors,
      ].join('; ')}`);
    }
    const authorityRuntimeValidation = validateProofRuntimeEvidence(
      authorityReplayEvidence.kernel.authenticatedRuntime,
      {
        trustPolicy,
        expectedDeployment,
      },
    );
    if (!authorityRuntimeValidation.ok
        || canonicalJson(authorityReplayEvidence.kernel.authenticatedRuntime)
          !== canonicalJson(proofRuntime)) {
      throw new Error(`protected authority replay used a different runtime: ${authorityRuntimeValidation.errors.join('; ')}`);
    }
    retainedReplayEvidence = authorityReplayEvidence;
    retainedReplayEvidenceDigest = digest(authorityReplayEvidence);
    const isResearchMain = obligationId === 'formal-proof-research-main-result';
    if (isResearchMain
        ? (!DIGEST.test(String(claimSemanticsSha256 || ''))
          || !DIGEST.test(String(researchArtifactDigest || '')))
        : (claimSemanticsSha256 !== null || researchArtifactDigest !== null)) {
      throw new Error('proof replay research artifact or claim-semantics binding is invalid');
    }
    const replayPayload = {
      obligationId,
      requestSha256: parsedRequest.requestSha256,
      originalEvidenceDigest: digest(kernelEvidence),
      replayEvidenceDigest: retainedReplayEvidenceDigest,
      taskBytesSha256: sha256Text(taskBytes),
      candidateBytesSha256: sha256Text(candidateBytes),
      templateSha256: sha256Text(trustedTemplateBytes),
      replaySessionId,
      claimSemanticsSha256,
      researchArtifactDigest,
      proofRuntimeEvidenceDigest: digest(proofRuntime),
      proofRuntimeAttestationSha256: proofRuntime.attestationSha256,
      proofRuntimeIdentitySha256: proofRuntime.runtimeIdentitySha256,
      proofRuntimeAuthorityId: proofRuntime.authorityId,
      proofRuntimeVerificationKeySha256: proofRuntime.verificationKeySha256,
    };
    if (!verifyAuthorityAttestation(replayAuthorityAttestation, {
      trustPolicy,
      capability: 'proof_replay',
    }) || canonicalJson(replayAuthorityAttestation.payload) !== canonicalJson(replayPayload)) {
      throw new Error('protected proof replay authority attestation is invalid');
    }
    const independence = validateCapabilityAuthorityIndependence({
      trustPolicy,
      firstAttestation: proofRuntime.attestation,
      firstCapability: 'proof_runtime',
      secondAttestation: replayAuthorityAttestation,
      secondCapability: 'proof_replay',
      requireProduction: true,
    });
    if (!independence.ok) {
      throw new Error(`proof runtime/replay authority independence failed: ${independence.errors.join('; ')}`);
    }
  }
  return sign({
    schemaVersion: PROOF_REPLAY_RECEIPT_SCHEMA,
    obligationId,
    requestBytesBase64: parsedRequest.bytes.toString('base64'),
    requestSha256: parsedRequest.requestSha256,
    kernelEvidenceDigest: digest(kernelEvidence),
    taskBytesSha256: kernelEvidence.bindings.taskBytesSha256,
    candidateBytesSha256: kernelEvidence.bindings.candidateBytesSha256,
    templateSha256: kernelEvidence.bindings.templateSha256,
    replayEvidenceDigest: retainedReplayEvidenceDigest,
    replayEvidence: structuredClone(retainedReplayEvidence),
    proofRuntimeEvidenceDigest: digest(proofRuntime),
    proofRuntimeAttestationSha256: proofRuntime.attestationSha256,
    proofRuntimeIdentitySha256: proofRuntime.runtimeIdentitySha256,
    proofRuntimeAuthorityId: proofRuntime.authorityId,
    proofRuntimeVerificationKeySha256: proofRuntime.verificationKeySha256,
    proofRuntime: structuredClone(proofRuntime),
    replaySessionId,
    replayAuthorityId: replayAuthorityAttestation?.authorityId || null,
    replayVerificationKeySha256: replayAuthorityAttestation?.signature?.keyId || null,
    replayAuthorityAttestation: structuredClone(replayAuthorityAttestation),
    claimSemanticsSha256,
    researchArtifactDigest,
    verified: true,
    truthBoundary: 'This signed receipt attests exact independent pinned-Lean replay only.',
  }, signingSecret);
}

export function createAcquisitionQualificationReceipt({
  subjectId,
  deployment,
  state,
  graph,
  rubric = null,
  policy,
  masterySecret,
  trustPolicy = null,
  acquisitionAuthorityAttestation = null,
  evidenceLedgerRoot = null,
  assessmentBank = null,
  assessmentRegistry = null,
  assessmentRegistryDigest = null,
  fixtureOnly = false,
  signingSecret,
  verifiedAt = new Date().toISOString(),
} = {}) {
  assertFixtureOnlyBoolean(fixtureOnly, 'acquisition receipt fixtureOnly');
  if (!ID.test(String(subjectId || ''))) throw new Error('invalid acquisition receipt subject');
  assertDeploymentBinding(deployment, deployment, {
    requiredContentIds: ['graph', 'acquisition-policy'],
  });
  const verification = verifyMasteryState(state, masterySecret, { graph, policy });
  if (!verification.ok) {
    throw new Error(`cannot attest unverified acquisition state: ${verification.errors.join('; ')}`);
  }
  const status = buildAcquisitionStatus({ state, graph });
  if (status.acquiredOnce.count !== graph.concepts.length
      || status.acquiredOnce.count !== 264
      || status.unassessed.count !== 0
      || status.learningOrCorrection.count !== 0
      || state.policyDigest !== deployment.contentDigests['acquisition-policy']
      || digest(graph) !== deployment.contentDigests.graph) {
    throw new Error('acquisition state is incomplete or not bound to the deployed 264-concept program');
  }
  const verifiedAtMs = Date.parse(String(verifiedAt || ''));
  if (!Number.isFinite(verifiedAtMs)
      || verifiedAtMs < Date.parse(state.updatedAt)
      || verifiedAtMs > Date.now() + 300_000) {
    throw new Error('acquisition receipt timestamp is invalid, backdated, or future-dated');
  }
  if (!fixtureOnly) {
    const bankValidation = validateIndependentAssessmentBank(assessmentBank, {
      graph,
      rubric,
      trustPolicy,
      deployment,
      campaignBinding: assessmentBank?.bindings?.campaign,
    });
    const registryValidation = validateProductionAcquisitionAssessmentRegistry({
      registry: assessmentRegistry,
      assessmentBank,
      graph,
      rubric,
      trustPolicy,
      deployment,
      campaignBinding: assessmentBank?.bindings?.campaign,
    });
    const computedAssessmentRegistryDigest = digest(assessmentRegistry);
    const computedAssessmentBankRecordDigest = digest(assessmentBank);
    const attestedPayload = {
      subjectId,
      stateDigest: digest(state),
      stateRevision: state.revision,
      curriculumId: state.curriculumId,
      policyDigest: state.policyDigest,
      evidenceLedgerRoot,
      assessmentRegistryDigest: computedAssessmentRegistryDigest,
      assessmentRegistryEntryCount: assessmentRegistry?.length,
      assessmentBankId: assessmentBank?.bankId,
      assessmentBankDigest: assessmentBank?.bankDigest,
      assessmentBankRecordDigest: computedAssessmentBankRecordDigest,
      assessmentCampaign: assessmentBank?.bindings?.campaign,
      acquiredConceptCount: status.acquiredOnce.count,
    };
    if (!DIGEST.test(String(evidenceLedgerRoot || ''))
        || !bankValidation.ok
        || assessmentBank?.purpose !== 'acquisition'
        || !registryValidation.ok
        || assessmentRegistryDigest !== computedAssessmentRegistryDigest
        || !verifyAuthorityAttestation(acquisitionAuthorityAttestation, {
          trustPolicy,
          capability: 'acquisition',
        })
        || canonicalJson(acquisitionAuthorityAttestation.payload) !== canonicalJson(attestedPayload)) {
      throw new Error('authenticated acquisition evidence ledger or assessment registry receipt is invalid');
    }
  }
  return sign({
    schemaVersion: ACQUISITION_QUALIFICATION_RECEIPT_SCHEMA,
    subjectId,
    fixtureOnly,
    verifiedAt,
    completedAt: state.updatedAt,
    stateRevision: state.revision,
    stateDigest: digest(state),
    curriculumId: state.curriculumId,
    policyDigest: state.policyDigest,
    deploymentDigest: deploymentBindingDigest(deployment),
    acquiredConceptCount: status.acquiredOnce.count,
    unassessedConceptCount: status.unassessed.count,
    learningOrCorrectionConceptCount: status.learningOrCorrection.count,
    evidenceLedgerRoot,
    assessmentBankId: assessmentBank?.bankId || null,
    assessmentBankDigest: assessmentBank?.bankDigest || null,
    assessmentBankRecordDigest: assessmentBank ? digest(assessmentBank) : null,
    assessmentBank: assessmentBank ? structuredClone(assessmentBank) : null,
    assessmentCampaign: structuredClone(assessmentBank?.bindings?.campaign || null),
    assessmentRegistryDigest,
    assessmentRegistry: structuredClone(assessmentRegistry),
    acquisitionAuthorityId: acquisitionAuthorityAttestation?.authorityId || null,
    acquisitionAuthorityAttestation: structuredClone(acquisitionAuthorityAttestation),
    truthBoundary: 'This receipt attests signed covered-once acquisition state only; it is not retention or qualification.',
  }, signingSecret);
}

const ACQUISITION_RECEIPT_FIELDS = Object.freeze([
  'acquiredConceptCount',
  'acquisitionAuthorityAttestation',
  'acquisitionAuthorityId',
  'assessmentBank',
  'assessmentBankDigest',
  'assessmentBankId',
  'assessmentBankRecordDigest',
  'assessmentCampaign',
  'assessmentRegistry',
  'assessmentRegistryDigest',
  'completedAt',
  'controlPlaneSignature',
  'curriculumId',
  'deploymentDigest',
  'evidenceLedgerRoot',
  'fixtureOnly',
  'learningOrCorrectionConceptCount',
  'policyDigest',
  'schemaVersion',
  'stateDigest',
  'stateRevision',
  'subjectId',
  'truthBoundary',
  'unassessedConceptCount',
  'verifiedAt',
]);

function acquisitionAuthorityPayload(receipt) {
  return {
    subjectId: receipt?.subjectId,
    stateDigest: receipt?.stateDigest,
    stateRevision: receipt?.stateRevision,
    curriculumId: receipt?.curriculumId,
    policyDigest: receipt?.policyDigest,
    evidenceLedgerRoot: receipt?.evidenceLedgerRoot,
    assessmentRegistryDigest: receipt?.assessmentRegistryDigest,
    assessmentRegistryEntryCount: receipt?.assessmentRegistry?.length,
    assessmentBankId: receipt?.assessmentBankId,
    assessmentBankDigest: receipt?.assessmentBankDigest,
    assessmentBankRecordDigest: receipt?.assessmentBankRecordDigest,
    assessmentCampaign: receipt?.assessmentCampaign,
    acquiredConceptCount: receipt?.acquiredConceptCount,
  };
}

export function validateProductionAcquisitionQualificationReceipt({
  receipt,
  graph,
  rubric,
  trustPolicy,
  deployment,
  signingSecret,
} = {}) {
  const errors = [];
  if (!exactKeys(receipt, ACQUISITION_RECEIPT_FIELDS)
      || receipt?.schemaVersion !== ACQUISITION_QUALIFICATION_RECEIPT_SCHEMA
      || !exactKeys(receipt?.controlPlaneSignature, ['algorithm', 'digest', 'keyId'])
      || !verifySignature(receipt, signingSecret)) {
    return { ok: false, errors: ['production acquisition receipt fields or signature mismatch'] };
  }
  const completedAtMs = Date.parse(String(receipt.completedAt || ''));
  const verifiedAtMs = Date.parse(String(receipt.verifiedAt || ''));
  if (receipt.fixtureOnly !== false
      || !ID.test(String(receipt.subjectId || ''))
      || !ID.test(String(receipt.curriculumId || ''))
      || receipt.curriculumId !== graph?.curriculumId
      || !Number.isSafeInteger(receipt.stateRevision) || receipt.stateRevision < 0
      || !DIGEST.test(String(receipt.stateDigest || ''))
      || receipt.policyDigest !== deployment?.contentDigests?.['acquisition-policy']
      || receipt.deploymentDigest !== deploymentBindingDigest(deployment)
      || receipt.acquiredConceptCount !== 264
      || receipt.acquiredConceptCount !== graph?.concepts?.length
      || receipt.unassessedConceptCount !== 0
      || receipt.learningOrCorrectionConceptCount !== 0
      || !DIGEST.test(String(receipt.evidenceLedgerRoot || ''))
      || !Number.isFinite(completedAtMs) || !Number.isFinite(verifiedAtMs)
      || new Date(completedAtMs).toISOString() !== receipt.completedAt
      || new Date(verifiedAtMs).toISOString() !== receipt.verifiedAt
      || verifiedAtMs < completedAtMs
      || receipt.truthBoundary
        !== 'This receipt attests signed covered-once acquisition state only; it is not retention or qualification.') {
    errors.push('production acquisition receipt status, deployment, count, time, or truth fields are invalid');
  }
  try {
    assertDeploymentBinding(deployment, deployment, {
      requiredContentIds: [
        'graph',
        'rubric',
        'acquisition-policy',
        'trust-policy',
      ],
    });
  } catch (error) {
    errors.push(error.message);
  }
  if (!isRecord(receipt.assessmentBank)
      || receipt.assessmentBankId !== receipt.assessmentBank?.bankId
      || receipt.assessmentBankDigest !== receipt.assessmentBank?.bankDigest
      || receipt.assessmentBankRecordDigest !== digest(receipt.assessmentBank)
      || canonicalJson(receipt.assessmentCampaign)
        !== canonicalJson(receipt.assessmentBank?.bindings?.campaign)
      || receipt.assessmentRegistryDigest !== digest(receipt.assessmentRegistry)) {
    errors.push('production acquisition receipt omits or substitutes exact signed bank bytes');
  }
  const registryValidation = validateProductionAcquisitionAssessmentRegistry({
    registry: receipt.assessmentRegistry,
    assessmentBank: receipt.assessmentBank,
    graph,
    rubric,
    trustPolicy,
    deployment,
    campaignBinding: receipt.assessmentCampaign,
  });
  errors.push(...registryValidation.errors);
  if (!verifyAuthorityAttestation(receipt.acquisitionAuthorityAttestation, {
        trustPolicy,
        capability: 'acquisition',
      })
      || receipt.acquisitionAuthorityId
        !== receipt.acquisitionAuthorityAttestation?.authorityId
      || canonicalJson(receipt.acquisitionAuthorityAttestation?.payload)
        !== canonicalJson(acquisitionAuthorityPayload(receipt))) {
    errors.push('production acquisition authority attestation does not bind the exact bank and registry');
  }
  return { ok: errors.length === 0, errors };
}

export function acquisitionBindingFromReceipt(receipt, signingSecret, {
  graph,
  rubric,
  trustPolicy,
  deployment,
} = {}) {
  const validation = validateProductionAcquisitionQualificationReceipt({
    receipt,
    graph,
    rubric,
    trustPolicy,
    deployment,
    signingSecret,
  });
  if (!validation.ok) {
    throw new Error('cannot derive retention binding from invalid acquisition receipt');
  }
  return {
    subjectId: receipt.subjectId,
    curriculumId: receipt.curriculumId,
    policyDigest: receipt.policyDigest,
    stateRevision: receipt.stateRevision,
    stateDigest: receipt.stateDigest,
    completedAt: receipt.completedAt,
  };
}

export function freezePhdCampaign({
  campaignId,
  subjectId,
  deployment,
  program,
  blueprint,
  graph = null,
  rubric = null,
  proofRegistry,
  sealedBanks,
  roles,
  declaredSpecializationTracks = [],
  qualificationFamilyLedger = null,
  acquisitionReceipt = null,
  researchProgram,
  modelRuntime,
  trustPolicy = null,
  frozenAt,
  expiresAt,
  signingSecret,
  fixtureOnly = false,
} = {}) {
  assertFixtureOnlyBoolean(fixtureOnly, 'campaign fixtureOnly');
  if (!ID.test(String(campaignId || '')) || !ID.test(String(subjectId || ''))) throw new Error('invalid campaign identity');
  if (!program?.ok) throw new Error('cannot freeze an invalid PhD program');
  const normalizedRoles = {
    ...structuredClone(roles),
    researchMaterializerSession: roles?.researchMaterializerSession
      || `${campaignId}.research-materializer`,
    researchReviewRequestSession: roles?.researchReviewRequestSession
      || `${campaignId}.research-review-request`,
    researchReproductionRunnerSession: roles?.researchReproductionRunnerSession
      || `${campaignId}.research-reproduction-runner`,
    retentionSessions: structuredClone(roles?.retentionSessions || []),
  };
  if (!uniqueRoleIds(normalizedRoles)) throw new Error('campaign independent role collision');
  const trustValidation = validatePhdTrustPolicy(trustPolicy, { requireProduction: !fixtureOnly });
  if (!trustValidation.ok) throw new Error(`campaign trust boundary is invalid: ${trustValidation.errors.join('; ')}`);
  assertDeploymentBinding(deployment, deployment, {
    requiredContentIds: [
      'graph',
      'rubric',
      'blueprint',
      'acquisition-policy',
      'retention-policy',
      'proof-registry',
      'proof-runtime-product',
      'trust-policy',
    ],
  });
  if (!fixtureOnly && deployment.executionClosure?.immutable !== true) {
    throw new Error('production campaign execution closure is not a root-owned immutable snapshot policy');
  }
  if (!fixtureOnly
      && deployment.schemaVersion !== APPROVED_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA) {
    throw new Error('production campaign deployment does not bind an approved model executable closure');
  }
  if (program.digests?.graph !== deployment.contentDigests.graph
      || program.digests?.rubric !== deployment.contentDigests.rubric
      || program.digests?.blueprint !== deployment.contentDigests.blueprint
      || digest(proofRegistry) !== deployment.contentDigests['proof-registry']) {
    throw new Error('campaign program or proof registry does not match the deployed content digests');
  }
  if (!isRecord(researchProgram)
      || digest(boundedFrozenValue(researchProgram.corpus, 'corpus')) !== researchProgram.corpusDigest
      || digest(boundedFrozenValue(researchProgram.environment, 'environment')) !== researchProgram.environmentDigest
      || digest(boundedFrozenValue(researchProgram.assumptions, 'assumptions')) !== researchProgram.assumptionsDigest
      || !DIGEST.test(String(researchProgram.corpusDigest || ''))
      || !DIGEST.test(String(researchProgram.environmentDigest || ''))
      || !DIGEST.test(String(researchProgram.assumptionsDigest || ''))
      || typeof researchProgram.boundedClaim !== 'string' || researchProgram.boundedClaim.length < 20
      || researchProgram.noveltyCeiling !== 'bounded_corpus_only') {
    throw new Error('bounded research program is incomplete or overclaims novelty');
  }
  if (!fixtureOnly) {
    const researchValidation = validateProductionResearchProgram(
      researchProgram,
      trustPolicy,
      deployment,
    );
    if (!researchValidation.ok) {
      throw new Error(`production research program is invalid: ${researchValidation.errors.join('; ')}`);
    }
  }
  const frozenAtMs = Date.parse(String(frozenAt || ''));
  const expiresAtMs = Date.parse(String(expiresAt || ''));
  if (!Number.isFinite(frozenAtMs) || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= frozenAtMs || expiresAtMs - frozenAtMs > 180 * 24 * 60 * 60 * 1000) {
    throw new Error('invalid campaign time window');
  }
  const specs = [...blueprint.coreExams, blueprint.specializationExam];
  if (roles.candidateSessions?.length !== specs.length
      || roles.proctorIds?.length !== specs.length
      || roles.graderIds?.length !== specs.length
      || roles.proofCandidateSessions?.length !== proofRegistry.entries.length
      || roles.proofReplaySessions?.length !== proofRegistry.entries.length) {
    throw new Error('campaign requires distinct exam and proof candidate/replay identities');
  }
  if (modelRuntime?.provider !== 'openai-codex'
      || modelRuntime?.thinking !== 'xhigh'
      || modelRuntime?.sandbox !== 'read-only'
      || modelRuntime?.toolsAllowed !== false
      || typeof modelRuntime?.model !== 'string' || modelRuntime.model.length < 1) {
    throw new Error('campaign requires an exact xhigh no-tools model runtime');
  }
  if (!isRecord(sealedBanks) || specs.some((spec) => sealedBanks[spec.examId]?.examId !== spec.examId)) {
    throw new Error('campaign sealed exam banks are incomplete');
  }
  const allowedSpecializationTracks = new Set(blueprint.specializationExam.eligibleTracks);
  if (!fixtureOnly && (!Array.isArray(declaredSpecializationTracks)
      || declaredSpecializationTracks.length < blueprint.specializationExam.minimumDeclaredTracks
      || new Set(declaredSpecializationTracks).size !== declaredSpecializationTracks.length
      || declaredSpecializationTracks.some((track) => !allowedSpecializationTracks.has(track)))) {
    throw new Error('campaign specialization tracks were not validly declared before bank selection');
  }
  if (!fixtureOnly) {
    const proctors = new Set(authorityIdsForCapability(trustPolicy, 'proctor'));
    const graders = new Set(authorityIdsForCapability(trustPolicy, 'grader'));
    if (roles.proctorIds.some((id) => !proctors.has(id))
        || roles.graderIds.some((id) => !graders.has(id))) {
      throw new Error('campaign proctor or grader identity is not a trusted independent authority');
    }
  }
  if (!fixtureOnly) {
    const ledgerValidation = validateQualificationFamilyLedger({
      campaignId,
      ledger: qualificationFamilyLedger,
      trustPolicy,
    });
    if (!ledgerValidation.ok) {
      throw new Error(ledgerValidation.errors.join('; '));
    }
  }
  if (!fixtureOnly) {
    acquisitionBindingFromReceipt(acquisitionReceipt, signingSecret, {
      graph,
      rubric,
      trustPolicy,
      deployment,
    });
    if (acquisitionReceipt.subjectId !== subjectId
        || acquisitionReceipt.deploymentDigest !== deploymentBindingDigest(deployment)
        || acquisitionReceipt.assessmentRegistryDigest !== digest(acquisitionReceipt.assessmentRegistry)) {
      throw new Error('campaign acquisition receipt or assessment registry does not match the deployment');
    }
  }
  const usedFamilies = new Set([
    ...(acquisitionReceipt?.assessmentRegistry?.map((entry) => entry.theoremFamilyId) || []),
    ...(qualificationFamilyLedger?.theoremFamilyIds || []),
  ]);
  const bankAuthorityIds = new Set();
  const exams = specs.map((spec, index) => {
    const bank = sealedBanks[spec.examId];
    if (bank.items.length < spec.minimumProblemCount
        || digest(bank.items) !== bank.bankDigest
        || digest(bank.items.map((item) => ({ itemId: item.itemId, checker: item.checker }))) !== bank.keyDigest) {
      throw new Error(`invalid sealed exam bank: ${spec.examId}`);
    }
    if (fixtureOnly) {
      if (bank.fixtureOnly !== true || bank.provenance !== 'synthetic_generated_fixture') {
        throw new Error(`fixture campaign requires an explicitly synthetic bank: ${spec.examId}`);
      }
      bank.items.forEach(replayGeneratedExercise);
    } else {
      const bankValidation = validateProductionQualificationBank({
        bank,
        spec,
        kind: index < blueprint.coreExams.length ? 'core' : 'specialization',
        graph,
        rubric,
        trustPolicy,
        declaredSpecializationTracks,
        acquisitionAssessmentRegistry: acquisitionReceipt.assessmentRegistry,
        qualificationFamilyLedger,
        usedFamilies,
      });
      if (!bankValidation.ok) {
        throw new Error(`invalid production sealed exam bank ${spec.examId}: ${bankValidation.errors.join('; ')}`);
      }
      bankAuthorityIds.add(bank.authorityAttestation.authorityId);
      bankAuthorityIds.add(bank.expertReviewAttestation.authorityId);
    }
    return {
      examId: spec.examId,
      examVersion: spec.version,
      kind: index < blueprint.coreExams.length ? 'core' : 'specialization',
      minimumProblemCount: spec.minimumProblemCount,
      passThreshold: spec.passThreshold,
      bankDigest: bank.bankDigest,
      keyDigest: bank.keyDigest,
      bankProvenanceDigest: digest(bank.provenance),
      acquisitionAssessmentRegistryDigest: bank.provenance?.acquisitionAssessmentRegistryDigest || null,
      promptCommitmentDigest: digest(bank.items.map((item) => ({
        itemId: item.itemId,
        prompt: item.prompt,
        answerFormat: item.answerFormat,
      }))),
      commitmentRecordedAt: frozenAt,
      candidateSessionId: roles.candidateSessions[index],
      proctorId: roles.proctorIds[index],
      graderId: roles.graderIds[index],
    };
  });
  if (!fixtureOnly && bankAuthorityIds.has(qualificationFamilyLedger.attestation.authorityId)) {
    throw new Error('qualification family registry authority must be independent of bank authorities');
  }
  const proofTemplates = proofRegistry.entries.map((entry, index) => {
    const isResearchMain = entry.obligationId === 'formal-proof-research-main-result';
    const fixtureResearchTemplate = fixtureOnly && isResearchMain;
    const frozenTemplateBytes = isResearchMain && !fixtureOnly
      ? Buffer.from(researchProgram.formalization.templateBase64, 'base64')
      : (fixtureResearchTemplate ? null : materializeProofTemplate({
        obligationId: entry.obligationId,
      }));
    if (frozenTemplateBytes !== null
        && !isResearchMain
        && sha256Text(frozenTemplateBytes) !== entry.templateBlueprintSha256) {
      throw new Error(`committed proof template drift: ${entry.obligationId}`);
    }
    const runId = `${campaignId}.proof.${index + 1}`;
    const seed = sha256Text(canonicalJson({
      campaignId,
      obligationId: entry.obligationId,
      deploymentDigest: deploymentBindingDigest(deployment),
      theoremStatementSha256: isResearchMain && !fixtureOnly
        ? researchProgram.formalization.theoremStatementSha256
        : sha256Text(entry.theoremStatement),
    }));
    const taskMaterialization = frozenTemplateBytes === null ? null : createObligationProofTask({
      obligationId: entry.obligationId,
      frozenTemplateBytes,
      expectedTemplateSha256: isResearchMain
        ? researchProgram.formalization.templateSha256
        : entry.templateBlueprintSha256,
      expectedTheoremStatementSha256: isResearchMain
        ? researchProgram.formalization.theoremStatementSha256
        : sha256Text(entry.theoremStatement),
      fixtureOnly,
      deployment,
      runId,
      seed,
    });
    return {
      obligationId: entry.obligationId,
      theoremStatementSha256: isResearchMain && !fixtureOnly
        ? researchProgram.formalization.theoremStatementSha256
        : sha256Text(entry.theoremStatement),
      templateBlueprintSha256: isResearchMain && !fixtureOnly
        ? researchProgram.formalization.templateSha256
        : entry.templateBlueprintSha256,
      frozenTemplateBase64: frozenTemplateBytes?.toString('base64') || null,
      frozenTemplateSha256: frozenTemplateBytes === null ? null : sha256Text(frozenTemplateBytes),
      frozenTaskBase64: taskMaterialization?.taskBytes.toString('base64') || null,
      frozenTaskSha256: taskMaterialization ? sha256Text(taskMaterialization.taskBytes) : null,
      taskIdentity: {
        taskId: taskMaterialization?.task.taskId || null,
        runId,
        seed,
      },
      researchArtifactBound: entry.researchArtifactBound,
      claimSemanticsSha256: isResearchMain && !fixtureOnly
        ? researchProgram.formalization.claimSemanticsSha256
        : null,
      source: isResearchMain
        ? (fixtureOnly
          ? 'synthetic_digest_binding_fixture'
          : 'campaign_frozen_external_theorem_source')
        : 'campaign_frozen_committed_obligation',
    };
  });
  const payload = {
    schemaVersion: PHD_CAMPAIGN_SCHEMA,
    campaignId,
    subjectId,
    curriculumId: blueprint.curriculum.curriculumId,
    fixtureOnly,
    trustPolicy: structuredClone(trustPolicy),
    trustPolicyDigest: digest(trustPolicy),
    declaredSpecializationTracks: structuredClone(declaredSpecializationTracks),
    acquisitionReceiptDigest: fixtureOnly ? null : digest(acquisitionReceipt),
    qualificationFamilyLedger: structuredClone(qualificationFamilyLedger),
    frozenAt,
    expiresAt,
    deployment,
    deploymentDigest: deploymentBindingDigest(deployment),
    programDigests: program.digests,
    proofRegistryDigest: proofRegistry.registryDigest,
    proofTemplates,
    exams,
    proofObligationIds: proofRegistry.entries.map((entry) => entry.obligationId),
    roles: normalizedRoles,
    researchProgram: structuredClone(researchProgram),
    modelRuntime: structuredClone(modelRuntime),
    executionBoundary: {
      heavyExecutionPlane: 'hetzner',
      canonicalStateOwner: 'control_plane',
      workersMayMutateCanonicalState: false,
      detached: true,
      notifierCompatible: true,
    },
    truthBoundary: 'A frozen campaign is an executable qualification plan, not evidence of a pass, retention, PhD capability, model-weight learning, or a degree.',
  };
  return sign(payload, signingSecret);
}

function verifyExamAttempt({
  campaign,
  exam,
  bank,
  attempt,
  harvestedWorkerCall = null,
}) {
  const errors = [];
  if (!attempt || attempt.examId !== exam.examId || attempt.subjectId !== campaign.subjectId) {
    return { passed: false, score: 0, errors: ['exam attempt scope mismatch'] };
  }
  if (digest(bank.items) !== exam.bankDigest || bank.keyDigest !== exam.keyDigest) {
    throw new Error('exam bank or key digest substitution');
  }
  if (attempt.promptCommitmentDigest !== exam.promptCommitmentDigest
      || Date.parse(attempt.promptReleasedAt) <= Date.parse(exam.commitmentRecordedAt)
      || Date.parse(attempt.startedAt) < Date.parse(attempt.promptReleasedAt)
      || Date.parse(attempt.completedAt) < Date.parse(attempt.startedAt)
      || Date.parse(attempt.startedAt) < Date.parse(campaign.frozenAt)
      || Date.parse(attempt.completedAt) > Date.parse(campaign.expiresAt)) {
    errors.push('exam commitment, release, or timestamp failure');
  }
  const expectedRelease = buildCandidateExamRelease({
    campaign,
    examId: exam.examId,
    sealedBank: bank,
    releasedAt: attempt.promptReleasedAt,
  });
  if (attempt.exactPromptBytes !== true
      || attempt.promptSha256 !== sha256Text(examPrompt(expectedRelease))) {
    errors.push('exam exact prompt bytes or commitment digest mismatch');
  }
  if (attempt.candidateSessionId !== exam.candidateSessionId
      || attempt.proctorId !== exam.proctorId
      || attempt.graderId !== exam.graderId
      || attempt.provider !== 'openai-codex'
      || attempt.model !== campaign.modelRuntime.model) {
    errors.push('exam role identity failure');
  }
  if (attempt.thinking !== 'xhigh' || attempt.toolsAllowed !== false
      || !Array.isArray(attempt.toolsUsed) || attempt.toolsUsed.length !== 0
      || !positiveUsage(attempt.usage)) errors.push('exam xhigh, no-tools, or positive usage failure');
  if (attempt.keyMaterialObserved === true
      || attempt.candidateKeyDigestObserved === exam.keyDigest
      || attempt.promptText?.includes('"checker"')) errors.push('exam prompt or key leakage');
  if (!Array.isArray(attempt.answers)
      || attempt.answers.length !== bank.items.length
      || new Set(attempt.answers.map((row) => row?.itemId)).size !== bank.items.length) {
    errors.push('exam answer set is partial or duplicated');
    return { passed: false, score: 0, errors };
  }
  let trustedExecution = null;
  let attestationDigest = null;
  if (campaign.fixtureOnly !== true) {
    const rawOutput = Buffer.from(attempt.candidateExecution?.rawOutputBase64 || '', 'base64');
    let parsedOutput;
    try { parsedOutput = JSON.parse(rawOutput.toString('utf8')); } catch { parsedOutput = null; }
    trustedExecution = verifyTrustedExecutionEvidence({
      attestation: attempt.candidateExecution?.attestation,
      trustPolicy: campaign.trustPolicy,
      executionEvidenceCore: attempt.candidateExecution?.executionEvidenceCore,
      executionEvidenceSha256: attempt.candidateExecution?.executionEvidenceSha256,
      inputBytes: Buffer.from(attempt.promptText || '', 'utf8'),
      rawOutputBytes: rawOutput,
      rawEventLedgerBytes: Buffer.from(attempt.candidateExecution?.rawEventLedgerBase64 || '', 'base64'),
      rawStderrBytes: Buffer.from(attempt.candidateExecution?.rawStderrBase64 || '', 'base64'),
      expected: {
        provider: campaign.modelRuntime.provider,
        model: campaign.modelRuntime.model,
        role: 'exam',
        plannedSessionId: exam.candidateSessionId,
        promptSha256: attempt.promptSha256,
        bindings: {
          candidateId: campaign.subjectId,
          candidateSessionId: exam.candidateSessionId,
          candidateSha256: sha256Bytes(rawOutput),
          taskId: exam.examId,
          taskSha256: digest({
            schemaVersion: 'cortex.learning_os.exam_job_task.v1',
            examId: exam.examId,
            kind: exam.kind,
            release: {
              schemaVersion: 'cortex.learning_os.candidate_exam_release.v1',
              campaignId: campaign.campaignId,
              subjectId: campaign.subjectId,
              examId: exam.examId,
              releasedAt: attempt.promptReleasedAt,
              promptCommitmentDigest: exam.promptCommitmentDigest,
              items: bank.items.map((item) => ({
                itemId: item.itemId,
                prompt: item.prompt,
                answerFormat: item.answerFormat,
              })),
              candidateKeyMaterialIncluded: false,
              truthBoundary: 'Candidate release omits checkers, key digests, grading thresholds, and bank metadata.',
            },
            releaseSha256: digest({
              schemaVersion: 'cortex.learning_os.candidate_exam_release.v1',
              campaignId: campaign.campaignId,
              subjectId: campaign.subjectId,
              examId: exam.examId,
              releasedAt: attempt.promptReleasedAt,
              promptCommitmentDigest: exam.promptCommitmentDigest,
              items: bank.items.map((item) => ({
                itemId: item.itemId,
                prompt: item.prompt,
                answerFormat: item.answerFormat,
              })),
              candidateKeyMaterialIncluded: false,
              truthBoundary: 'Candidate release omits checkers, key digests, grading thresholds, and bank metadata.',
            }),
            promptCommitmentDigest: exam.promptCommitmentDigest,
          }),
          jobId: `${campaign.campaignId}.${exam.examId}`,
          campaignId: campaign.campaignId,
          campaignSha256: digest(campaign),
          deploymentSha256: campaign.deploymentDigest,
          sourceSha256: executionSourceSha256(campaign.deployment),
        },
        startedAt: attempt.startedAt,
        completedAt: attempt.completedAt,
        notBefore: attempt.promptReleasedAt,
        notAfter: campaign.expiresAt,
        approvedExecutable: campaign.deployment.approvedModelExecutable,
        ...(harvestedWorkerCall === null ? {} : {
          command: harvestedWorkerCall.executionEvidenceCore?.command,
          observedEnvironment: harvestedWorkerCall.executionEvidenceCore?.environment?.observed,
        }),
      },
    });
    attestationDigest = executionAttestationDigest(attempt.candidateExecution);
    if (!trustedExecution.ok
        || (campaign.schemaVersion === PHD_CAMPAIGN_SCHEMA
          && !exactHarvestedModelCallMatches(
            attempt.candidateExecution,
            harvestedWorkerCall,
          ))
        || attempt.startedAt !== attempt.candidateExecution?.startedAt
        || attempt.completedAt !== attempt.candidateExecution?.completedAt
        || attempt.outputSha256 !== attempt.candidateExecution?.outputSha256
        || attempt.outputSha256 !== trustedExecution.payload?.outputSha256
        || attempt.outputSha256 !== sha256Bytes(rawOutput)
        || canonicalJson(parsedOutput?.answers) !== canonicalJson(attempt.answers)) {
      errors.push(...trustedExecution.errors, 'exam answers are not the exact trusted raw provider output');
    }
    const receiptPayload = {
      campaignId: campaign.campaignId,
      examId: exam.examId,
      promptSha256: attempt.promptSha256,
      outputSha256: attempt.outputSha256,
      providerRequestId: trustedExecution.payload?.providerRequestId,
      executionAttestationDigest: attestationDigest,
      executionEvidenceSha256: trustedExecution.executionEvidenceSha256,
      startedAt: trustedExecution.payload?.startedAt,
      completedAt: trustedExecution.payload?.completedAt,
    };
    if (!verifyAuthorityAttestation(attempt.proctorReceipt, {
      trustPolicy: campaign.trustPolicy,
      capability: 'proctor',
    }) || attempt.proctorReceipt.authorityId !== exam.proctorId
        || canonicalJson(attempt.proctorReceipt.payload) !== canonicalJson({
          ...receiptPayload,
          noPriorAccessObserved: true,
          noToolsObserved: true,
        })) {
      errors.push('independent authenticated proctor receipt is invalid');
    }
  }
  const answerById = new Map(attempt.answers.map((row) => [row.itemId, row.answer]));
  const results = bank.items.map((item) => {
    if (!answerById.has(item.itemId)) return false;
    return campaign.fixtureOnly
      ? verifyGeneratedAnswer({ item, answer: answerById.get(item.itemId) }).passed === true
      : checkAnswer(answerById.get(item.itemId), item.checker).passed === true;
  });
  const score = results.filter(Boolean).length / results.length;
  const passed = errors.length === 0 && score >= exam.passThreshold;
  if (campaign.fixtureOnly !== true) {
    if (!verifyAuthorityAttestation(attempt.graderReceipt, {
      trustPolicy: campaign.trustPolicy,
      capability: 'grader',
    }) || attempt.graderReceipt.authorityId !== exam.graderId
        || canonicalJson(attempt.graderReceipt.payload) !== canonicalJson({
          campaignId: campaign.campaignId,
          examId: exam.examId,
          outputSha256: attempt.outputSha256,
          keyDigest: exam.keyDigest,
          score,
          passed,
          providerRequestId: trustedExecution.payload?.providerRequestId,
          executionAttestationDigest: attestationDigest,
          executionEvidenceSha256: trustedExecution.executionEvidenceSha256,
          startedAt: trustedExecution.payload?.startedAt,
          completedAt: trustedExecution.payload?.completedAt,
        })) {
      errors.push('independent authenticated grader receipt is invalid');
    }
  }
  if (attempt.claimedScore !== score || attempt.claimedPassed !== passed) errors.push('exam threshold recomputation mismatch');
  return { passed: errors.length === 0 && passed, score, errors };
}

function verifyResearch(campaign, research, proofRuns, {
  harvestedModelCallsByJob = null,
} = {}) {
  const errors = [];
  if (!isRecord(research)) return { passed: false, errors: ['research artifact is missing'] };
  if (campaign.fixtureOnly !== true) {
    const program = campaign.researchProgram;
    const candidatePrompt = researchPrompt({
      campaign,
      role: 'research_candidate',
    });
    const candidatePromptSha256 = sha256Text(candidatePrompt);
    const rawCandidateOutput = Buffer.from(research.candidateExecution?.rawOutputBase64 || '', 'base64');
    let parsedCandidateOutput;
    try { parsedCandidateOutput = JSON.parse(rawCandidateOutput.toString('utf8')); } catch {
      parsedCandidateOutput = null;
    }
    const candidateExecutionErrors = noToolsExecutionErrors(research.candidateExecution, campaign, {
      sessionId: campaign.roles.researchCandidateSession,
      promptSha256: candidatePromptSha256,
      promptBytes: Buffer.from(candidatePrompt, 'utf8'),
      role: 'research_candidate',
      bindings: {
        taskId: null,
        taskSha256: digest({
          schemaVersion: 'cortex.learning_os.research_model_job_task.v1',
          researchProgramDigest: digest(campaign.researchProgram),
          artifactDigest: null,
        }),
        jobId: `${campaign.campaignId}.research_candidate`,
      },
      harvestedWorkerCall: harvestedModelCallsByJob?.get(
        `${campaign.campaignId}.research_candidate`,
      ) || null,
    });
    if (research.candidateSessionId !== campaign.roles.researchCandidateSession
        || candidateExecutionErrors.length
        || canonicalJson(parsedCandidateOutput?.artifact) !== canonicalJson(research.artifact)
        || canonicalJson(parsedCandidateOutput?.result) !== canonicalJson(research.result)
        || canonicalJson(parsedCandidateOutput?.novelty) !== canonicalJson(research.novelty)) {
      errors.push(
        ...candidateExecutionErrors,
        'research artifact, result, and novelty are not the exact trusted raw candidate output',
      );
    }
    if (research.artifactDigest !== digest(research.artifact)
        || research.resultDigest !== digest(research.result)
        || research.sourceBundleSha256 !== program.sourceBundleSha256
        || research.environmentDigest !== program.environmentDigest
        || research.mainTheoremTemplateSha256 !== program.formalization.templateSha256
        || research.reproduction?.commandDigest !== digest(program.reproduction.command)
        || !DIGEST.test(String(research.reproduction?.stdoutSha256 || ''))
        || !DIGEST.test(String(research.reproduction?.stderrSha256 || ''))
        || research.reproduction?.exitCode !== 0
        || !validateExecutionEvidenceRecord({
          core: research.reproduction?.executionEvidenceCore,
          executionEvidenceSha256: research.reproduction?.executionEvidenceSha256,
        }).ok
        || !Array.isArray(research.reproduction?.outputs)
        || research.reproduction.outputs.length !== program.reproduction.outputPaths.length
        || research.reproduction.outputs.some((row, index) => (
          row.path !== program.reproduction.outputPaths[index]
          || !DIGEST.test(String(row.sha256 || ''))
        ))) {
      errors.push('research source, immutable environment, command, logs, or recomputed outputs are incomplete');
    }
    const attestationValidation = validateProductionResearchAttestations({
      campaign,
      artifactDigest: research.artifactDigest,
      result: research.result,
      resultDigest: research.resultDigest,
      candidateExecution: research.candidateExecution,
      reproductionBundle: research.reproduction,
      reviewAttestation: research.review?.attestation,
      reviewRequestBinding: research.review?.request,
      harvestedWorkerCall: harvestedModelCallsByJob?.get(
        `${campaign.campaignId}.research_candidate`,
      ) || null,
    });
    errors.push(...attestationValidation.errors);
    const independentAuthorities = [
      research.candidateExecution?.attestation?.authorityId,
      research.reproduction?.attestation?.authorityId,
      research.review?.attestation?.authorityId,
      program.formalization?.correspondenceAttestation?.authorityId,
    ];
    if (independentAuthorities.some((authorityId) => !ID.test(String(authorityId || '')))
        || new Set(independentAuthorities).size !== independentAuthorities.length) {
      errors.push('research execution, reproduction, review, and formal correspondence authorities are not independent');
    }
    const mainProof = proofRuns.find((run) => run.obligationId === 'formal-proof-research-main-result');
    if (!mainProof
        || mainProof.researchArtifactDigest !== research.artifactDigest
        || mainProof.researchClaimSemanticsSha256 !== program.formalization.claimSemanticsSha256
        || mainProof.replayReceipt?.claimSemanticsSha256 !== program.formalization.claimSemanticsSha256
        || mainProof.replayReceipt?.researchArtifactDigest !== research.artifactDigest
        || mainProof.replayReceipt?.templateSha256 !== research.mainTheoremTemplateSha256) {
      errors.push('formal research proof is not bound to the extracted artifact claim semantics');
    }
    if (!NOVELTY.has(research.novelty?.status)
        || research.novelty?.status === 'externally_established'
        || research.novelty?.globalNoveltyClaim === true) {
      errors.push('research novelty overclaim');
    }
    return { passed: errors.length === 0, errors };
  }
  const roles = campaign.roles;
  if (research.candidateSessionId !== roles.researchCandidateSession
      || research.review?.sessionId !== roles.researchReviewerSession
      || research.reproduction?.sessionId !== roles.researchReproducerSession
      || new Set([
        research.candidateSessionId,
        research.review?.sessionId,
        research.reproduction?.sessionId,
      ]).size !== 3) errors.push('research role collision');
  const candidatePromptSha256 = sha256Text(researchPrompt({
    campaign,
    role: 'research_candidate',
  }));
  const reviewPromptSha256 = DIGEST.test(String(research.artifactDigest || ''))
    ? sha256Text(researchPrompt({
      campaign,
      role: 'adversarial_review',
      artifact: research.artifact,
      artifactDigest: research.artifactDigest,
    }))
    : null;
  const reproductionPromptSha256 = DIGEST.test(String(research.artifactDigest || ''))
    ? sha256Text(researchPrompt({
      campaign,
      role: 'reproduction',
      artifact: research.artifact,
      artifactDigest: research.artifactDigest,
    }))
    : null;
  if (noToolsExecutionErrors(research.candidateExecution, campaign, {
    sessionId: roles.researchCandidateSession,
    promptSha256: candidatePromptSha256,
    role: 'research_candidate',
  }).length
      || research.candidateExecution?.artifactDigest !== research.artifactDigest) {
    errors.push('research candidate execution identity, usage, prompt, or artifact binding failure');
  }
  if (noToolsExecutionErrors(research.review?.execution, campaign, {
    sessionId: roles.researchReviewerSession,
    promptSha256: reviewPromptSha256,
    role: 'adversarial_review',
  }).length
      || research.review?.execution?.artifactDigest !== research.artifactDigest
      || research.review?.execution?.reviewDigest !== research.review?.reviewDigest) {
    errors.push('research adversarial review execution identity, usage, prompt, or output binding failure');
  }
  if (noToolsExecutionErrors(research.reproduction?.execution, campaign, {
    sessionId: roles.researchReproducerSession,
    promptSha256: reproductionPromptSha256,
    role: 'reproduction',
  }).length
      || research.reproduction?.execution?.artifactDigest !== research.artifactDigest
      || research.reproduction?.execution?.resultDigest !== research.resultDigest) {
    errors.push('research reproduction execution identity, usage, prompt, or output binding failure');
  }
  if (!DIGEST.test(String(research.artifactDigest || ''))
      || research.artifactDigest !== digest(research.artifact)
      || research.resultDigest !== digest(research.result)
      || research.corpusDigest !== campaign.researchProgram.corpusDigest
      || research.environmentDigest !== campaign.researchProgram.environmentDigest
      || research.assumptionsDigest !== campaign.researchProgram.assumptionsDigest) {
    errors.push('research artifact, corpus, environment, or assumptions drift');
  }
  if (research.review?.artifactDigest !== research.artifactDigest
      || research.review?.status !== 'passed'
      || research.review?.adversarial !== true
      || research.review?.reviewDigest !== digest(research.review?.artifact)) errors.push('research adversarial review failure');
  if (research.reproduction?.artifactDigest !== research.artifactDigest
      || research.reproduction?.environmentDigest !== research.environmentDigest
      || research.reproduction?.resultDigest !== research.resultDigest
      || research.reproduction?.resultDigest !== digest(research.reproduction?.result)
      || research.reproduction?.status !== 'passed') errors.push('research reproduction mismatch');
  if (!NOVELTY.has(research.novelty?.status)
      || research.novelty?.status === 'externally_established'
      || research.novelty?.globalNoveltyClaim === true
      || (research.novelty?.status === 'bounded_corpus_only'
        && !/frozen|bounded|declared corpus/i.test(String(research.novelty.scope || '')))) {
    errors.push('research novelty overclaim');
  }
  const mainProof = proofRuns.find((run) => run.obligationId === 'formal-proof-research-main-result');
  const expectedTemplateSha256 = DIGEST.test(String(research.artifactDigest || ''))
    ? sha256Text(materializeProofTemplate({
      obligationId: 'formal-proof-research-main-result',
      researchArtifactDigest: research.artifactDigest,
      fixtureOnly: true,
    }))
    : null;
  if (!mainProof || mainProof.researchArtifactDigest !== research.artifactDigest
      || mainProof.replayReceipt?.templateSha256 !== research.mainTheoremTemplateSha256
      || research.mainTheoremTemplateSha256 !== expectedTemplateSha256) {
    errors.push('research artifact-main-theorem digest mismatch');
  }
  return { passed: errors.length === 0, errors };
}

export function verifyPhdCampaign({
  campaign,
  qualificationPlan = null,
  harvestState = null,
  artifactManifestBytesByJob = null,
  artifactFileBytesByJob = null,
  expectedDeployment,
  graph = null,
  rubric = null,
  retentionPolicy = null,
  sealedBanks,
  examAttempts = [],
  proofRuns = [],
  research = null,
  retentionStatus,
  retentionWindows = [],
  retentionAssessmentBanks = [],
  acquisitionReceipt,
  signingSecret,
  evaluatedAt,
  verificationBundleSha256 = null,
} = {}) {
  assertCampaignFixtureOnly(campaign);
  if (campaign?.schemaVersion !== PHD_CAMPAIGN_SCHEMA || !verifySignature(campaign, signingSecret)) {
    throw new Error('campaign signature mismatch');
  }
  const trustValidation = validatePhdTrustPolicy(campaign.trustPolicy, {
    requireProduction: campaign.fixtureOnly !== true,
  });
  if (!trustValidation.ok
      || campaign.trustPolicyDigest !== digest(campaign.trustPolicy)
      || campaign.deployment.contentDigests['trust-policy'] !== digest(campaign.trustPolicy)) {
    throw new Error(`campaign production trust boundary mismatch: ${trustValidation.errors.join('; ')}`);
  }
  assertDeploymentBinding(campaign.deployment, expectedDeployment);
  if (campaign.deploymentDigest !== deploymentBindingDigest(expectedDeployment)) {
    throw new Error('campaign deployment digest substitution');
  }
  const evaluatedAtMs = Date.parse(String(evaluatedAt || ''));
  if (!Number.isFinite(evaluatedAtMs)
      || evaluatedAtMs < Date.parse(campaign.frozenAt)
      || (!campaign.fixtureOnly && Math.abs(Date.now() - evaluatedAtMs) > 300_000)) {
    throw new Error('campaign archival evaluation timestamp is invalid, backdated, future-dated, or stale');
  }
  if (!uniqueRoleIds(campaign.roles)) throw new Error('campaign same-session independence fraud');
  const harvestValidation = campaign.fixtureOnly === true
    ? {
      ok: false,
      errors: ['fixture campaigns do not carry production harvest authority'],
      binding: null,
      receiptsByJob: new Map(),
      manifestsByJob: new Map(),
      filesByJob: new Map(),
      modelCallsByJob: new Map(),
    }
    : verifyQualificationHarvestEvidence({
      plan: qualificationPlan,
      harvestState,
      artifactManifestBytesByJob,
      artifactFileBytesByJob,
      campaign,
      signingSecret,
      now: evaluatedAt,
      requireArtifactManifests: true,
      requireArtifactFiles: true,
    });
  if (campaign.fixtureOnly !== true && !harvestValidation.ok) {
    throw new Error(`campaign exact authenticated harvest mismatch: ${harvestValidation.errors.join('; ')}`);
  }
  if (campaign.fixtureOnly !== true) {
    const materializationJobId = `${campaign.campaignId}.formal-research-theorem`;
    const researchJobId = `${campaign.campaignId}.research_candidate`;
    const materializationJob = qualificationPlan.jobs.find((job) => (
      job.jobId === materializationJobId
    ));
    const researchMainProofJob = qualificationPlan.jobs.find((job) => (
      job.jobId === `${campaign.campaignId}.formal-proof-research-main-result`
        && job.role === 'proof_candidate'
    ));
    const exactMaterializationBytes = harvestValidation.filesByJob
      .get(materializationJobId)
      ?.get('output.json');
    let materialization;
    try {
      materialization = JSON.parse(exactMaterializationBytes?.toString('utf8') || '');
    } catch {
      materialization = null;
    }
    const proofTask = materializationJob?.task?.proofTask;
    if (materializationJob?.executor !== 'frozen_task_materialization'
        || canonicalJson(materializationJob.dependencies) !== canonicalJson([researchJobId])
        || proofTask?.schemaVersion !== DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA
        || researchMainProofJob?.task?.schemaVersion
          !== DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA
        || canonicalJson(researchMainProofJob.task) !== canonicalJson(proofTask)
        || canonicalJson(researchMainProofJob.dependencies)
          !== canonicalJson([researchJobId])
        || canonicalJson(materializationJob.task.researchArtifactSource)
          !== canonicalJson(proofTask.researchArtifactSource)
        || materialization?.schemaVersion
          !== 'cortex.learning_os.formal_research_materialization.v1'
        || materialization.obligationId !== 'formal-proof-research-main-result'
        || materialization.taskBytesSha256 !== proofTask.taskBytesSha256
        || materialization.trustedTemplateSha256 !== proofTask.trustedTemplateSha256
        || materialization.theoremStatementSha256 !== proofTask.theoremStatementSha256
        || materialization.claimSemanticsSha256 !== proofTask.claimSemanticsSha256
        || materialization.researchArtifactDigest !== research?.artifactDigest
        || materialization.dependencyOutputSha256
          !== harvestValidation.manifestsByJob.get(researchJobId)?.outputSha256
        || canonicalJson(materialization.researchArtifactSource)
          !== canonicalJson(proofTask.researchArtifactSource)) {
      throw new Error(
        'campaign research-main proof is not the exact authenticated post-artifact materialization',
      );
    }
  }
  const harvestedExecutionMatches = (execution, expectedJobId) => {
    if (campaign.fixtureOnly === true) return true;
    const receipt = harvestValidation.receiptsByJob.get(expectedJobId);
    const manifest = harvestValidation.manifestsByJob.get(expectedJobId);
    const harvestedCall = harvestValidation.modelCallsByJob.get(expectedJobId);
    const job = qualificationPlan.jobs.find((candidate) => candidate.jobId === expectedJobId);
    return Boolean(receipt && manifest && harvestedCall && job)
      && exactHarvestedModelCallMatches(execution, harvestedCall)
      && execution?.jobId === expectedJobId
      && execution?.jobDigest === receipt.jobDigest
      && execution?.notBefore === receipt.notBefore
      && execution?.startedAt === receipt.startedAt
      && execution?.completedAt === receipt.completedAt
      && execution?.expiresAt === receipt.expiresAt
      && execution?.executionIntervalSha256 === receipt.executionIntervalSha256
      && execution?.promptSha256 === manifest.promptSha256
      && execution?.outputSha256 === manifest.outputSha256
      && canonicalJson(execution?.executionIdentity)
        === canonicalJson(receipt.executionIdentity);
  };
  const harvestedProofRequestMatches = (run) => {
    if (campaign.fixtureOnly === true) return true;
    const jobId = `${campaign.campaignId}.${run?.obligationId}`;
    const requestBytes = harvestValidation.filesByJob
      .get(jobId)
      ?.get('independent-replay-request.json');
    const receiptBytes = Buffer.from(run?.replayReceipt?.requestBytesBase64 || '', 'base64');
    return Boolean(requestBytes)
      && requestBytes.equals(receiptBytes)
      && sha256Bytes(requestBytes) === run?.replayReceipt?.requestSha256;
  };
  const harvestedResearchReviewRequestMatches = () => {
    if (campaign.fixtureOnly === true) return true;
    const exactBinding = harvestedResearchReviewRequestBinding({
      campaign,
      qualificationPlan,
      harvest: harvestValidation,
    });
    return exactBinding !== null
      && canonicalJson(exactBinding) === canonicalJson(research?.review?.request);
  };
  const harvestedRetentionWindowMatches = (window, index) => {
    if (campaign.fixtureOnly === true) return true;
    const jobId = `${campaign.campaignId}.retention.${index + 1}`;
    const receipt = harvestValidation.receiptsByJob.get(jobId);
    const manifest = harvestValidation.manifestsByJob.get(jobId);
    const files = harvestValidation.filesByJob.get(jobId);
    const execution = window?.execution;
    if (!receipt || !manifest || !files || !execution) return false;
    const rawOutput = Buffer.from(execution.rawOutputBase64 || '', 'base64');
    const rawLedger = Buffer.from(execution.rawEventLedgerBase64 || '', 'base64');
    const rawStderr = Buffer.from(execution.rawStderrBase64 || '', 'base64');
    return canonicalJson(window.qualificationHarvestBinding)
        === canonicalJson(harvestValidation.binding)
      && execution.jobId === jobId
      && execution.jobDigest === receipt.jobDigest
      && execution.jobNotBefore === receipt.notBefore
      && execution.jobExpiresAt === receipt.expiresAt
      && execution.startedAt === receipt.startedAt
      && execution.completedAt === receipt.completedAt
      && execution.executionIntervalSha256 === receipt.executionIntervalSha256
      && execution.promptSha256 === manifest.promptSha256
      && execution.outputSha256 === manifest.outputSha256
      && canonicalJson(execution.executionIdentity) === canonicalJson(receipt.executionIdentity)
      && execution.executionEvidenceCore?.bindings?.jobSha256 === receipt.jobDigest
      && (files.get('output.json') || Buffer.alloc(0)).equals(rawOutput)
      && (files.get('raw-events.ndjson') || Buffer.alloc(0)).equals(rawLedger)
      && (files.get('stderr.raw') || Buffer.alloc(0)).equals(rawStderr);
  };
  let productionAcquisitionBinding = null;
  if (campaign.fixtureOnly !== true) {
    const acquisitionValidation = validateProductionAcquisitionQualificationReceipt({
      receipt: acquisitionReceipt,
      graph,
      rubric,
      trustPolicy: campaign.trustPolicy,
      deployment: campaign.deployment,
      signingSecret,
    });
    if (!acquisitionValidation.ok
        || campaign.acquisitionReceiptDigest !== digest(acquisitionReceipt)) {
      throw new Error(`campaign exact acquisition bank/registry receipt mismatch: ${acquisitionValidation.errors.join('; ')}`);
    }
    productionAcquisitionBinding = acquisitionBindingFromReceipt(acquisitionReceipt, signingSecret, {
      graph,
      rubric,
      trustPolicy: campaign.trustPolicy,
      deployment: campaign.deployment,
    });
    const ledgerValidation = validateQualificationFamilyLedger({
      campaignId: campaign.campaignId,
      ledger: campaign.qualificationFamilyLedger,
      trustPolicy: campaign.trustPolicy,
    });
    if (!ledgerValidation.ok) {
      throw new Error(`campaign qualification family ledger mismatch: ${ledgerValidation.errors.join('; ')}`);
    }
    const usedFamilies = new Set([
      ...acquisitionReceipt.assessmentRegistry.map((entry) => entry.theoremFamilyId),
      ...campaign.qualificationFamilyLedger.theoremFamilyIds,
    ]);
    const bankAuthorityIds = new Set();
    for (const exam of campaign.exams) {
      const bank = sealedBanks?.[exam.examId];
      const expectedAttestationPayload = {
        examId: bank?.examId,
        examVersion: bank?.examVersion,
        bankDigest: bank?.bankDigest,
        keyDigest: bank?.keyDigest,
        provenanceDigest: digest(bank?.provenance),
      };
      const expectedReviewPayload = {
        ...expectedAttestationPayload,
        status: 'approved',
        graduateQualificationReviewed: true,
      };
      if (bank?.schemaVersion !== 'cortex.learning_os.sealed_exam_bank.v2'
          || bank.fixtureOnly !== false
          || bank.examId !== exam.examId
          || bank.examVersion !== exam.examVersion
          || digest(bank.items) !== exam.bankDigest
          || bank.keyDigest !== exam.keyDigest
          || digest(bank.provenance) !== exam.bankProvenanceDigest
          || bank.provenance?.acquisitionAssessmentRegistryDigest
            !== acquisitionReceipt.assessmentRegistryDigest
          || bank.provenance?.priorQualificationFamilyLedgerDigest
            !== digest(campaign.qualificationFamilyLedger)
          || !verifyAuthorityAttestation(bank.authorityAttestation, {
            trustPolicy: campaign.trustPolicy,
            capability: 'bank_authoring',
          })
          || canonicalJson(bank.authorityAttestation?.payload)
            !== canonicalJson(expectedAttestationPayload)
          || !verifyAuthorityAttestation(bank.expertReviewAttestation, {
            trustPolicy: campaign.trustPolicy,
            capability: 'bank_review',
          })
          || bank.expertReviewAttestation?.authorityId === bank.authorityAttestation?.authorityId
          || canonicalJson(bank.expertReviewAttestation?.payload)
            !== canonicalJson(expectedReviewPayload)) {
        throw new Error(`campaign sealed bank authority binding mismatch: ${exam.examId}`);
      }
      bankAuthorityIds.add(bank.authorityAttestation.authorityId);
      bankAuthorityIds.add(bank.expertReviewAttestation.authorityId);
      for (const item of bank.items) {
        const familyId = item?.qualification?.theoremFamilyId;
        if (!ID.test(String(familyId || '')) || usedFamilies.has(familyId)) {
          throw new Error(`campaign qualification theorem family reuse: ${String(familyId || 'missing')}`);
        }
        usedFamilies.add(familyId);
      }
    }
    if (bankAuthorityIds.has(campaign.qualificationFamilyLedger.attestation.authorityId)) {
      throw new Error('campaign qualification family registry is not independent of bank authority');
    }
  }
  const examResults = campaign.exams.map((exam) => {
    const bank = sealedBanks?.[exam.examId];
    const attempt = examAttempts.find((row) => row.examId === exam.examId);
    if (!bank) return { examId: exam.examId, passed: false, score: 0, errors: ['sealed bank missing'] };
    const result = verifyExamAttempt({
      campaign,
      exam,
      bank,
      attempt,
      harvestedWorkerCall: harvestValidation.modelCallsByJob.get(
        `${campaign.campaignId}.${exam.examId}`,
      ) || null,
    });
    return { examId: exam.examId, ...result };
  });
  const proofErrors = [];
  const seenProofSessions = new Set();
  const proofPasses = [];
  for (const [proofIndex, obligationId] of campaign.proofObligationIds.entries()) {
    const run = proofRuns.find((row) => row.obligationId === obligationId);
    const proofTemplate = campaign.proofTemplates[proofIndex];
    const validation = validateKernelEvidence(run?.kernelEvidence);
    const rawProofBindingErrors = [];
    let exactTaskBytes = Buffer.alloc(0);
    let exactCandidateBytes = Buffer.alloc(0);
    let exactTemplateBytes = Buffer.alloc(0);
    let taskEnvelope = null;
    let candidateEnvelope = null;
    if (campaign.fixtureOnly !== true) {
      exactTaskBytes = Buffer.from(run?.taskBytesBase64 || '', 'base64');
      exactCandidateBytes = Buffer.from(run?.candidateBytesBase64 || '', 'base64');
      exactTemplateBytes = Buffer.from(run?.trustedTemplateBytesBase64 || '', 'base64');
      try {
        taskEnvelope = parseProofRecordBytes(exactTaskBytes, 'campaign proof task');
        candidateEnvelope = parseProofRecordBytes(exactCandidateBytes, 'campaign proof candidate');
        const taskValidation = validateProofTask(taskEnvelope.record);
        const candidateValidation = validateProofCandidate(candidateEnvelope.record, exactTaskBytes);
        if (!taskValidation.ok || !candidateValidation.ok) {
          rawProofBindingErrors.push(...taskValidation.errors, ...candidateValidation.errors);
        }
      } catch (error) {
        rawProofBindingErrors.push(error.message);
      }
      const rawProviderOutput = Buffer.from(run?.candidateExecution?.rawOutputBase64 || '', 'base64');
      let parsedProviderOutput;
      try { parsedProviderOutput = JSON.parse(rawProviderOutput.toString('utf8')); } catch {
        parsedProviderOutput = null;
      }
      if (taskEnvelope?.record?.conceptId !== obligationId
          || candidateEnvelope?.record?.conceptId !== obligationId
          || (proofTemplate?.frozenTaskSha256 !== null
            && taskEnvelope?.bytesSha256 !== proofTemplate?.frozenTaskSha256)
          || taskEnvelope?.record?.taskId !== proofTemplate?.taskIdentity?.taskId
          || taskEnvelope?.record?.runIdentity?.runId !== proofTemplate?.taskIdentity?.runId
          || taskEnvelope?.record?.runIdentity?.seed !== proofTemplate?.taskIdentity?.seed
          || canonicalJson(parsedProviderOutput) !== canonicalJson({
            proofTerm: candidateEnvelope?.record?.proof?.term,
          })
          || taskEnvelope?.bytesSha256 !== run?.kernelEvidence?.bindings?.taskBytesSha256
          || candidateEnvelope?.bytesSha256 !== run?.kernelEvidence?.bindings?.candidateBytesSha256
          || sha256Text(exactTemplateBytes) !== run?.kernelEvidence?.bindings?.templateSha256) {
        rawProofBindingErrors.push('proof raw provider output or exact task/candidate/template bytes are not kernel-bound');
      }
    }
    const replayReceipt = run?.replayReceipt;
    const authenticatedProofJob = campaign.fixtureOnly === true
      ? null
      : qualificationPlan?.jobs?.find((job) => (
        job?.jobId === `${campaign.campaignId}.${obligationId}`
        && job?.role === 'proof_candidate'
      ));
    const authenticatedProofTask = authenticatedProofJob?.task;
    const researchMainProof = obligationId === 'formal-proof-research-main-result';
    const dependentResearchProof = authenticatedProofTask?.schemaVersion
      === DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA;
    const authenticatedResearchJob = dependentResearchProof
      ? qualificationPlan?.jobs?.find((job) => (
        job?.jobId === authenticatedProofTask.researchArtifactSource.dependencyJobId
      ))
      : null;
    const materializationProofTask = researchMainProof && campaign.fixtureOnly !== true
      ? qualificationPlan?.jobs?.find((job) => (
        job?.jobId === `${campaign.campaignId}.formal-research-theorem`
          && job?.role === 'formal_research_theorem'
      ))?.task?.proofTask
      : null;
    const expectedResearchArtifactDigest = dependentResearchProof
      ? research?.artifactDigest ?? null
      : researchMainProof ? null : authenticatedProofTask?.researchArtifactDigest ?? null;
    if (campaign.fixtureOnly !== true
        && (!validateProofCandidateJobTask(authenticatedProofTask).ok
          || authenticatedProofTask.obligationId !== obligationId
          || canonicalJson(authenticatedProofJob.dependencies)
            !== canonicalJson(dependentResearchProof
              ? [authenticatedProofTask.researchArtifactSource.dependencyJobId]
              : [])
          || authenticatedProofTask.taskBytesBase64 !== exactTaskBytes.toString('base64')
          || authenticatedProofTask.taskBytesSha256 !== taskEnvelope?.bytesSha256
          || authenticatedProofTask.trustedTemplateBase64
            !== exactTemplateBytes.toString('base64')
          || authenticatedProofTask.trustedTemplateSha256
            !== sha256Text(exactTemplateBytes)
          || authenticatedProofTask.theoremStatementSha256
            !== taskEnvelope?.record?.theorem?.statementSha256
          || authenticatedProofTask.replaySessionId
            !== campaign.roles.proofReplaySessions[proofIndex]
          || authenticatedProofTask.claimSemanticsSha256
            !== proofTemplate?.claimSemanticsSha256
          || (researchMainProof && (
            !dependentResearchProof
            || canonicalJson(materializationProofTask)
              !== canonicalJson(authenticatedProofTask)
          ))
          || (dependentResearchProof
            ? (authenticatedProofTask.researchArtifactDigest !== null
              || authenticatedProofTask.researchArtifactSource.dependencyJobId
                !== `${campaign.campaignId}.research_candidate`
              || authenticatedProofTask.researchArtifactSource.candidateSessionId
                !== campaign.roles.researchCandidateSession
              || authenticatedResearchJob?.role !== 'research_candidate'
              || authenticatedResearchJob?.sessionId
                !== authenticatedProofTask.researchArtifactSource.candidateSessionId
              || authenticatedResearchJob?.promptSha256
                !== authenticatedProofTask.researchArtifactSource.candidatePromptSha256)
            : authenticatedProofTask.researchArtifactDigest
              !== expectedResearchArtifactDigest)
          || expectedResearchArtifactDigest
            !== (replayReceipt?.researchArtifactDigest ?? null))) {
      rawProofBindingErrors.push(
        'proof bytes, template, replay, or research binding differs from the exact authenticated plan task',
      );
    }
    const candidateExecutionErrors = noToolsExecutionErrors(run?.candidateExecution, campaign, {
      sessionId: campaign.roles.proofCandidateSessions[proofIndex],
      exactInputField: 'exactTaskBytesSupplied',
      role: 'proof_candidate',
      promptSha256: campaign.fixtureOnly === true
        ? null
        : sha256Text(proofCandidatePrompt(exactTaskBytes)),
      promptBytes: campaign.fixtureOnly === true
        ? null
        : Buffer.from(proofCandidatePrompt(exactTaskBytes), 'utf8'),
      bindings: campaign.fixtureOnly === true ? {} : {
        taskId: taskEnvelope?.record?.taskId || null,
        taskSha256: isRecord(authenticatedProofTask)
          ? digest(authenticatedProofTask)
          : null,
        jobId: `${campaign.campaignId}.${obligationId}`,
      },
      harvestedWorkerCall: harvestValidation.modelCallsByJob.get(
        `${campaign.campaignId}.${obligationId}`,
      ) || null,
    });
    if (run?.candidateExecution?.taskBytesSha256 !== run?.kernelEvidence?.bindings?.taskBytesSha256
        || run?.candidateExecution?.candidateBytesSha256 !== run?.kernelEvidence?.bindings?.candidateBytesSha256) {
      candidateExecutionErrors.push('candidate execution task or candidate digest substitution');
    }
    const runtimeChain = campaign.fixtureOnly === true
      ? { ok: true, errors: [] }
      : validateProofRuntimeReplayChain({
        kernelEvidence: run?.kernelEvidence,
        replayReceipt,
        trustPolicy: campaign.trustPolicy,
        expectedDeployment,
      });
    rawProofBindingErrors.push(...runtimeChain.errors);
    if (campaign.fixtureOnly !== true) {
      try {
        const request = parseProofReplayRequestBytes(
          Buffer.from(replayReceipt?.requestBytesBase64 || '', 'base64'),
        ).request;
        if (request.campaignId !== campaign.campaignId
            || request.jobId !== `${campaign.campaignId}.${obligationId}`
            || request.obligationId !== obligationId
            || request.replaySessionId !== campaign.roles.proofReplaySessions[proofIndex]
            || request.proofTaskSha256 !== digest(authenticatedProofTask)
            || request.taskBytesBase64 !== authenticatedProofTask?.taskBytesBase64
            || request.taskBytesSha256 !== authenticatedProofTask?.taskBytesSha256
            || request.trustedTemplateBase64
              !== authenticatedProofTask?.trustedTemplateBase64
            || request.trustedTemplateSha256
              !== authenticatedProofTask?.trustedTemplateSha256
            || request.theoremStatementSha256 !== proofTemplate?.theoremStatementSha256
            || request.claimSemanticsSha256 !== proofTemplate?.claimSemanticsSha256
            || request.researchArtifactDigest
              !== expectedResearchArtifactDigest) {
          throw new Error('campaign proof identity mismatch');
        }
      } catch (error) {
        rawProofBindingErrors.push(`proof replay request campaign binding: ${error.message}`);
      }
    }
    const replayAttestationPayload = {
      obligationId,
      requestSha256: replayReceipt?.requestSha256 ?? null,
      originalEvidenceDigest: isRecord(run?.kernelEvidence)
        ? digest(run.kernelEvidence)
        : null,
      replayEvidenceDigest: replayReceipt?.replayEvidenceDigest ?? null,
      taskBytesSha256: run?.kernelEvidence?.bindings?.taskBytesSha256 ?? null,
      candidateBytesSha256: run?.kernelEvidence?.bindings?.candidateBytesSha256 ?? null,
      templateSha256: run?.kernelEvidence?.bindings?.templateSha256 ?? null,
      replaySessionId: replayReceipt?.replaySessionId ?? null,
      claimSemanticsSha256: replayReceipt?.claimSemanticsSha256 ?? null,
      researchArtifactDigest: replayReceipt?.researchArtifactDigest ?? null,
      proofRuntimeEvidenceDigest: replayReceipt?.proofRuntimeEvidenceDigest ?? null,
      proofRuntimeAttestationSha256: replayReceipt?.proofRuntimeAttestationSha256 ?? null,
      proofRuntimeIdentitySha256: replayReceipt?.proofRuntimeIdentitySha256 ?? null,
      proofRuntimeAuthorityId: replayReceipt?.proofRuntimeAuthorityId ?? null,
      proofRuntimeVerificationKeySha256: replayReceipt?.proofRuntimeVerificationKeySha256 ?? null,
    };
    const replayReceiptValid = exactKeys(replayReceipt, PROOF_REPLAY_RECEIPT_KEYS)
      && replayReceipt.schemaVersion === PROOF_REPLAY_RECEIPT_SCHEMA
      && verifySignature(replayReceipt, signingSecret)
      && replayReceipt.obligationId === obligationId
      && replayReceipt.kernelEvidenceDigest === digest(run?.kernelEvidence)
      && replayReceipt.taskBytesSha256 === run?.kernelEvidence?.bindings?.taskBytesSha256
      && replayReceipt.candidateBytesSha256 === run?.kernelEvidence?.bindings?.candidateBytesSha256
      && replayReceipt.templateSha256 === run?.kernelEvidence?.bindings?.templateSha256
      && replayReceipt.verified === true
      && runtimeChain.ok
      && (campaign.fixtureOnly === true
        || (verifyAuthorityAttestation(replayReceipt.replayAuthorityAttestation, {
          trustPolicy: campaign.trustPolicy,
          capability: 'proof_replay',
        })
          && replayReceipt.replayAuthorityId === replayReceipt.replayAuthorityAttestation.authorityId
          && replayReceipt.replayVerificationKeySha256
            === replayReceipt.replayAuthorityAttestation.signature.keyId
          && canonicalJson(replayReceipt.replayAuthorityAttestation.payload)
            === canonicalJson(replayAttestationPayload)));
    const passed = Boolean(run)
      && validation.ok
      && proofTemplate?.obligationId === obligationId
      && run.kernelEvidence.conceptId === obligationId
      && run.kernelEvidence.bindings.theoremStatementSha256 === proofTemplate.theoremStatementSha256
      && (campaign.fixtureOnly === true && proofTemplate.source === 'synthetic_digest_binding_fixture'
        ? run.kernelEvidence.bindings.templateSha256 === replayReceipt?.templateSha256
        : run.kernelEvidence.bindings.templateSha256 === proofTemplate.templateBlueprintSha256)
      && run.kernelEvidence.kernelAccepted === true
      && replayReceiptValid
      && candidateExecutionErrors.length === 0
      && rawProofBindingErrors.length === 0
      && run.candidateSessionId === campaign.roles.proofCandidateSessions[proofIndex]
      && replayReceipt.replaySessionId === campaign.roles.proofReplaySessions[proofIndex]
      && run.candidateSessionId !== replayReceipt.replaySessionId
      && !seenProofSessions.has(run.candidateSessionId)
      && !seenProofSessions.has(replayReceipt.replaySessionId);
    if (!passed) {
      proofErrors.push(`${obligationId}: ${[
        ...validation.errors,
        ...candidateExecutionErrors,
        ...rawProofBindingErrors,
      ].join('; ') || 'missing acceptance/replay/independence'}`);
    }
    else {
      seenProofSessions.add(run.candidateSessionId);
      seenProofSessions.add(replayReceipt.replaySessionId);
      try { assertDeploymentBinding(run.kernelEvidence.deployment, expectedDeployment); } catch (error) {
        proofErrors.push(`${obligationId}: ${error.message}`);
      }
    }
    proofPasses.push({ obligationId, passed: passed && !proofErrors.some((error) => error.startsWith(`${obligationId}:`)) });
  }
  const researchResult = verifyResearch(campaign, research, proofRuns, {
    harvestedModelCallsByJob: harvestValidation.modelCallsByJob,
  });
  const banksBindExactAcquisitionRegistry = campaign.fixtureOnly === true
    || campaign.exams.every((exam) => {
      const bank = sealedBanks?.[exam.examId];
      return exam.bankProvenanceDigest === digest(bank?.provenance)
        && exam.acquisitionAssessmentRegistryDigest === acquisitionReceipt?.assessmentRegistryDigest
        && bank?.provenance?.acquisitionAssessmentRegistryDigest === acquisitionReceipt?.assessmentRegistryDigest;
    });
  const acquisitionQualified = acquisitionReceipt?.schemaVersion === ACQUISITION_QUALIFICATION_RECEIPT_SCHEMA
    && verifySignature(acquisitionReceipt, signingSecret)
    && acquisitionReceipt.fixtureOnly === campaign.fixtureOnly
    && acquisitionReceipt.subjectId === campaign.subjectId
    && acquisitionReceipt.deploymentDigest === campaign.deploymentDigest
    && acquisitionReceipt.curriculumId === campaign.curriculumId
    && acquisitionReceipt.policyDigest === campaign.deployment.contentDigests['acquisition-policy']
    && acquisitionReceipt.acquiredConceptCount === 264
    && acquisitionReceipt.unassessedConceptCount === 0
    && acquisitionReceipt.learningOrCorrectionConceptCount === 0
    && banksBindExactAcquisitionRegistry
    && (campaign.fixtureOnly === true
      || (productionAcquisitionBinding !== null
        && campaign.acquisitionReceiptDigest === digest(acquisitionReceipt)
        && canonicalJson(productionAcquisitionBinding) === canonicalJson({
          subjectId: acquisitionReceipt.subjectId,
          curriculumId: acquisitionReceipt.curriculumId,
          policyDigest: acquisitionReceipt.policyDigest,
          stateRevision: acquisitionReceipt.stateRevision,
          stateDigest: acquisitionReceipt.stateDigest,
          completedAt: acquisitionReceipt.completedAt,
        })));
  const retentionValidation = campaign.fixtureOnly === true
    ? { ok: false, errors: ['fixture campaigns cannot produce production retention qualification'] }
    : verifyProductionRetentionQualification({
      status: retentionStatus,
      windows: retentionWindows,
      assessmentBanks: retentionAssessmentBanks,
      policy: retentionPolicy,
      deployment: campaign.deployment,
      trustPolicy: campaign.trustPolicy,
      campaignBinding: {
        campaignId: campaign.campaignId,
        campaignDigest: digest(campaign),
      },
      acquisitionBinding: productionAcquisitionBinding,
      graph,
      rubric,
      signingSecret,
      qualificationHarvestBinding: harvestValidation.binding,
      harvestedModelCallsByJob: harvestValidation.modelCallsByJob,
    });
  const retentionQualified = retentionValidation.ok
    && retentionStatus.subjectId === campaign.subjectId
    && retentionStatus.deploymentDigest === campaign.deploymentDigest
    && retentionStatus.acquisitionStateDigest === acquisitionReceipt?.stateDigest;
  const examExecutionEvidenceRecords = examAttempts.map((attempt) => ({
      core: attempt?.candidateExecution?.executionEvidenceCore,
      executionEvidenceSha256: attempt?.candidateExecution?.executionEvidenceSha256,
    }));
  const proofExecutionEvidenceRecords = proofRuns.map((run) => ({
      core: run?.candidateExecution?.executionEvidenceCore,
      executionEvidenceSha256: run?.candidateExecution?.executionEvidenceSha256,
    }));
  const researchExecutionEvidenceRecords = [{
    core: research?.candidateExecution?.executionEvidenceCore,
    executionEvidenceSha256: research?.candidateExecution?.executionEvidenceSha256,
  }, {
    core: research?.reproduction?.executionEvidenceCore,
    executionEvidenceSha256: research?.reproduction?.executionEvidenceSha256,
  }];
  const retentionExecutionEvidenceRecords = retentionStatus?.executionEvidenceRecords || [];
  const collectedExecutionEvidenceRecords = campaign.fixtureOnly === true ? [] : [
    ...examExecutionEvidenceRecords,
    ...proofExecutionEvidenceRecords,
    ...researchExecutionEvidenceRecords,
    ...retentionExecutionEvidenceRecords,
  ];
  const executionEvidenceRecords = collectedExecutionEvidenceRecords.filter((record) => (
    validateExecutionEvidenceRecord(record).ok
  ));
  const expectedExecutionEvidenceCount = campaign.exams.length
    + campaign.proofObligationIds.length
    + 2
    + 2;
  const campaignSha256 = digest(campaign);
  const sourceSha256 = executionSourceSha256(campaign.deployment);
  const commonBindingMatches = (record, expectedSourceSha256 = sourceSha256) => (
    record?.core?.bindings?.campaignId === campaign.campaignId
    && record.core.bindings.campaignSha256 === campaignSha256
    && record.core.bindings.deploymentSha256 === campaign.deploymentDigest
    && record.core.bindings.sourceSha256 === expectedSourceSha256
  );
  const exactExecutionBindingsQualified = campaign.fixtureOnly === false
    && examExecutionEvidenceRecords.every((record, index) => (
      commonBindingMatches(record)
      && record.core.executionKind === 'model'
      && record.core.environment.declared.role === 'exam'
      && record.core.bindings.candidateId === campaign.subjectId
      && record.core.bindings.candidateSessionId === campaign.exams[index]?.candidateSessionId
      && record.core.bindings.taskId === campaign.exams[index]?.examId
      && record.core.bindings.jobId
        === `${campaign.campaignId}.${campaign.exams[index]?.examId}`
    ))
    && proofExecutionEvidenceRecords.every((record, index) => (
      commonBindingMatches(record)
      && record.core.executionKind === 'model'
      && record.core.environment.declared.role === 'proof_candidate'
      && record.core.bindings.candidateId === null
      && record.core.bindings.candidateSessionId
        === campaign.roles.proofCandidateSessions[index]
      && record.core.bindings.taskId === campaign.proofTemplates[index]?.taskIdentity?.taskId
      && record.core.bindings.jobId
        === `${campaign.campaignId}.${campaign.proofObligationIds[index]}`
    ))
    && commonBindingMatches(researchExecutionEvidenceRecords[0])
    && researchExecutionEvidenceRecords[0].core.executionKind === 'model'
    && researchExecutionEvidenceRecords[0].core.environment.declared.role
      === 'research_candidate'
    && researchExecutionEvidenceRecords[0].core.bindings.candidateId === null
    && researchExecutionEvidenceRecords[0].core.bindings.candidateSessionId
      === campaign.roles.researchCandidateSession
    && researchExecutionEvidenceRecords[0].core.bindings.jobId
      === `${campaign.campaignId}.research_candidate`
    && commonBindingMatches(
      researchExecutionEvidenceRecords[1],
      campaign.researchProgram.sourceBundleSha256,
    )
    && researchExecutionEvidenceRecords[1].core.executionKind === 'process'
    && researchExecutionEvidenceRecords[1].core.bindings.candidateId === null
    && researchExecutionEvidenceRecords[1].core.bindings.candidateSessionId
      === campaign.roles.researchCandidateSession
    && researchExecutionEvidenceRecords[1].core.bindings.jobId
      === `${campaign.campaignId}.research-reproduction`
    && retentionExecutionEvidenceRecords.length === 2
    && retentionExecutionEvidenceRecords.every((record, index) => (
      commonBindingMatches(record)
      && record.core.executionKind === 'model'
      && record.core.environment.declared.role === 'retention'
      && record.core.bindings.candidateId === campaign.subjectId
      && record.core.bindings.candidateSessionId === campaign.roles.retentionSessions[index]
      && record.core.bindings.jobId
        === `${campaign.campaignId}.retention.${index + 1}`
    ));
  const executionEvidenceQualified = campaign.fixtureOnly === false
    && collectedExecutionEvidenceRecords.length === expectedExecutionEvidenceCount
    && executionEvidenceRecords.length === collectedExecutionEvidenceRecords.length
    && exactExecutionBindingsQualified
    && new Set(executionEvidenceRecords.map((record) => (
      record.executionEvidenceSha256
    ))).size === executionEvidenceRecords.length;
  const assembledHarvestBindingMatches = (evidence) => (
    canonicalJson(evidence?.qualificationHarvestBinding)
      === canonicalJson(harvestValidation.binding)
  );
  const harvestedExecutionSetQualified = campaign.fixtureOnly === false
    && examAttempts.every((attempt) => harvestedExecutionMatches(
      attempt?.candidateExecution,
      `${campaign.campaignId}.${attempt?.examId}`,
    ) && assembledHarvestBindingMatches(attempt))
    && proofRuns.every((run) => harvestedExecutionMatches(
      run?.candidateExecution,
      `${campaign.campaignId}.${run?.obligationId}`,
    ) && harvestedProofRequestMatches(run) && assembledHarvestBindingMatches(run))
    && harvestedExecutionMatches(
      research?.candidateExecution,
      `${campaign.campaignId}.research_candidate`,
    )
    && assembledHarvestBindingMatches(research)
    && harvestedReproductionBundleMatches({
      campaign,
      qualificationPlan,
      reproductionBundle: research?.reproduction,
      harvest: harvestValidation,
    })
    && harvestedResearchReviewRequestMatches()
    && retentionWindows.length === 2
    && retentionWindows.every(harvestedRetentionWindowMatches);
  const coreExams = examResults.filter((result) => (
    campaign.exams.find((exam) => exam.examId === result.examId)?.kind === 'core'
  ));
  const specialization = examResults.find((result) => (
    campaign.exams.find((exam) => exam.examId === result.examId)?.kind === 'specialization'
  ));
  const layers = {
    acquisition: acquisitionQualified,
    retention: retentionQualified,
    qualification: coreExams.length === 4 && coreExams.every((result) => result.passed),
    proof: proofPasses.length === campaign.proofObligationIds.length && proofPasses.every((result) => result.passed),
    specialization: specialization?.passed === true,
    research: researchResult.passed,
    executionEvidence: executionEvidenceQualified,
    qualificationHarvest: harvestedExecutionSetQualified,
  };
  const mechanicalGatesSatisfied = Object.values(layers).every(Boolean);
  const productionClaimEligible = campaign.fixtureOnly === false && mechanicalGatesSatisfied;
  if (verificationBundleSha256 !== null
      && !DIGEST.test(String(verificationBundleSha256 || ''))) {
    throw new Error('campaign verification bundle digest is invalid');
  }
  if (productionClaimEligible && verificationBundleSha256 === null) {
    throw new Error(
      'qualified campaign verification requires the exact brokered underlying bundle digest',
    );
  }
  const blockers = [
    ...examResults.flatMap((result) => result.errors.map((error) => `exam:${result.examId}:${error}`)),
    ...proofErrors.map((error) => `proof:${error}`),
    ...researchResult.errors.map((error) => `research:${error}`),
    ...(!acquisitionQualified ? ['acquisition:264-concept signed state is incomplete'] : []),
    ...(!retentionQualified ? [
      `retention:two-window retained mastery is not qualified${
        retentionValidation.errors.length ? `: ${retentionValidation.errors.join('; ')}` : ''
      }`,
    ] : []),
    ...(!executionEvidenceQualified
      ? ['execution-evidence:canonical authenticated execution cores are incomplete']
      : []),
    ...(!harvestedExecutionSetQualified
      ? ['qualification-harvest:exact authenticated terminal job set is incomplete or detached']
      : []),
    ...(campaign.fixtureOnly ? ['claim:fixture campaigns never qualify live claims'] : []),
  ];
  return sign({
    schemaVersion: PHD_CAMPAIGN_REPORT_SCHEMA,
    campaignId: campaign.campaignId,
    subjectId: campaign.subjectId,
    evaluatedAt,
    deploymentDigest: campaign.deploymentDigest,
    verificationBundleSha256,
    qualificationHarvestBinding: structuredClone(harvestValidation.binding),
    layers,
    examResults,
    proofResults: proofPasses,
    research: researchResult,
    executionEvidenceRecords: structuredClone(executionEvidenceRecords),
    blockers,
    mechanicalGatesSatisfied,
    phd_math_qualified: productionClaimEligible,
    claimTruth: productionClaimEligible
      ? QUALIFIED_CAMPAIGN_CLAIM_TRUTH
      : UNQUALIFIED_CAMPAIGN_CLAIM_TRUTH,
  }, signingSecret);
}

function validCampaignReportHarvestBinding(binding, report) {
  return exactKeys(binding, QUALIFICATION_HARVEST_BINDING_KEYS)
    && [
      'planDigest', 'harvestStateDigest', 'campaignDigest', 'deploymentDigest',
      'descriptorSetSha256', 'jobSetSha256', 'receiptSetSha256',
      'artifactSetSha256', 'modelCallSetSha256',
    ].every((field) => DIGEST.test(String(binding[field] || '')))
    && binding.deploymentDigest === report.deploymentDigest
    && Number.isSafeInteger(binding.jobCount)
    && binding.jobCount > 0;
}

export function verifyPhdCampaignReport(report, signingSecret) {
  if (!exactKeys(report, PHD_CAMPAIGN_REPORT_KEYS)
      || report.schemaVersion !== PHD_CAMPAIGN_REPORT_SCHEMA
      || !verifySignature(report, signingSecret)
      || !ID.test(String(report.campaignId || ''))
      || !ID.test(String(report.subjectId || ''))
      || !DIGEST.test(String(report.deploymentDigest || ''))
      || (report.verificationBundleSha256 !== null
        && !DIGEST.test(String(report.verificationBundleSha256 || '')))
      || !Number.isFinite(Date.parse(String(report.evaluatedAt || '')))
      || new Date(Date.parse(report.evaluatedAt)).toISOString() !== report.evaluatedAt
      || !exactKeys(report.layers, PHD_CAMPAIGN_REPORT_LAYER_KEYS)
      || Object.values(report.layers).some((value) => typeof value !== 'boolean')
      || !Array.isArray(report.examResults)
      || !Array.isArray(report.proofResults)
      || !isRecord(report.research)
      || !Array.isArray(report.executionEvidenceRecords)
      || !Array.isArray(report.blockers)
      || report.blockers.some((blocker) => typeof blocker !== 'string' || blocker.length < 1)
      || typeof report.mechanicalGatesSatisfied !== 'boolean'
      || typeof report.phd_math_qualified !== 'boolean'
      || report.mechanicalGatesSatisfied
        !== Object.values(report.layers).every((value) => value === true)
      || report.phd_math_qualified !== report.mechanicalGatesSatisfied
      || report.claimTruth !== (report.phd_math_qualified
        ? QUALIFIED_CAMPAIGN_CLAIM_TRUTH
        : UNQUALIFIED_CAMPAIGN_CLAIM_TRUTH)
      || (report.qualificationHarvestBinding !== null
        && !validCampaignReportHarvestBinding(
          report.qualificationHarvestBinding,
          report,
        ))
      || (report.layers.qualificationHarvest === true
        && report.qualificationHarvestBinding === null)
      || !report.executionEvidenceRecords.every((record) => (
        validateExecutionEvidenceRecord(record).ok
      ))) {
    return false;
  }
  if (report.phd_math_qualified !== true) return true;
  return report.verificationBundleSha256 !== null
    && report.layers.executionEvidence === true
    && report.layers.qualificationHarvest === true
    && report.blockers.length === 0
    && report.executionEvidenceRecords.length > 0
    && report.executionEvidenceRecords.length
      === report.examResults.length + report.proofResults.length + 4
    && report.executionEvidenceRecords.every((record) => (
      record.core.bindings.campaignId === report.campaignId
      && record.core.bindings.campaignSha256
        === report.executionEvidenceRecords[0].core.bindings.campaignSha256
      && record.core.bindings.deploymentSha256 === report.deploymentDigest
      && [null, report.subjectId].includes(record.core.bindings.candidateId)
    ))
    && new Set(report.executionEvidenceRecords.map((record) => (
      record.executionEvidenceSha256
    ))).size === report.executionEvidenceRecords.length;
}

export function atomicWritePhdCampaignReport(
  reportPath,
  report,
  signingSecret,
  { crashInjector = null, fixtureOnly = false } = {},
) {
  assertFixtureOnlyBoolean(fixtureOnly, 'campaign report publication fixtureOnly');
  if (!verifyPhdCampaignReport(report, signingSecret)) {
    throw new Error('refusing to persist an invalid campaign report');
  }
  if (report.phd_math_qualified === true) {
    throw new Error(
      'qualified campaign report publication requires complete underlying campaign verification',
    );
  }
  return atomicWriteSignedControlPlaneRecord(reportPath, report, signingSecret, {
    authenticate: (candidate) => verifyPhdCampaignReport(candidate, signingSecret)
      && candidate.phd_math_qualified !== true,
    crashInjector,
    fixtureOnly,
  });
}

function consumePublishedPhdCampaignPair({
  bundlePath,
  crashInjector,
  fixtureOnly,
  report,
  reportPath,
  signingSecret,
  verificationInputs,
  verificationBundleSha256,
}) {
  const expectedBundle = canonicalJson(verificationInputs);
  const expectedReport = canonicalJson(report);
  const readPublishedJson = (target, label, consume) => (
    fixtureOnly === true
      ? readAuthorityJson(target, label, { consume })
      : readRootBrokeredAuthorityJson(target, label, { consume })
  ).consumed;
  const observe = (phase) => {
    if (crashInjector !== null) crashInjector(phase);
  };
  const consumeReport = (candidate) => {
    if (!verifyPhdCampaignReport(candidate, signingSecret)
        || candidate.verificationBundleSha256 !== verificationBundleSha256
        || canonicalJson(candidate) !== expectedReport) {
      throw new Error(
        'published campaign report differs from the completely verified campaign',
      );
    }
    observe('pair_after_report_consumption_before_bundle_confirmation');
    return candidate;
  };

  observe('pair_before_published_consumption');
  if (bundlePath === null) {
    const consumedReport = readPublishedJson(
      reportPath,
      'published fixture campaign report',
      consumeReport,
    );
    observe('pair_after_published_consumption');
    return consumedReport;
  }
  const consumedReport = readPublishedJson(
    bundlePath,
    'published campaign bundle',
    (candidate) => {
      let recomputed;
      try {
        recomputed = verifyPhdCampaign({
          ...candidate,
          signingSecret,
          evaluatedAt: report.evaluatedAt,
          verificationBundleSha256:
            phdCampaignVerificationBundleSha256(candidate),
        });
      } catch (error) {
        throw new Error(
          `published campaign bundle failed complete verification: ${error.message}`,
          { cause: error },
        );
      }
      if (canonicalJson(candidate) !== expectedBundle
          || phdCampaignVerificationBundleSha256(candidate)
            !== verificationBundleSha256
          || canonicalJson(recomputed) !== expectedReport) {
        throw new Error(
          'published campaign bundle does not reproduce the exact verified campaign report',
        );
      }
      observe('pair_after_bundle_consumption_before_report_consumption');
      return readPublishedJson(
        reportPath,
        'published campaign report',
        consumeReport,
      );
    },
  );
  observe('pair_after_published_consumption');
  return consumedReport;
}

export function verifyAndAtomicWritePhdCampaignReport(
  reportPath,
  verificationInputs,
  signingSecret,
  {
    bundlePath = null,
    crashInjector = null,
    fixtureOnly = false,
  } = {},
) {
  assertFixtureOnlyBoolean(fixtureOnly, 'campaign report publication fixtureOnly');
  if (!isRecord(verificationInputs)
      || Object.prototype.hasOwnProperty.call(verificationInputs, 'signingSecret')
      || Object.prototype.hasOwnProperty.call(
        verificationInputs,
        'verificationBundleSha256',
      )) {
    throw new Error(
      'campaign report publication requires complete underlying verification inputs without secret material or a self-declared bundle digest',
    );
  }
  const verifiedCampaignIsFixture =
    verificationInputs.campaign?.fixtureOnly === true;
  if (fixtureOnly !== verifiedCampaignIsFixture) {
    throw new Error(
      'campaign report publication mode must match the completely verified campaign',
    );
  }
  if (fixtureOnly !== true && (
    typeof bundlePath !== 'string'
    || bundlePath.length < 1
  )) {
    throw new Error(
      'production campaign report publication requires a brokered underlying bundle target',
    );
  }
  const verificationBundleSha256 = bundlePath === null
    ? null
    : phdCampaignVerificationBundleSha256(verificationInputs);
  const report = verifyPhdCampaign({
    ...verificationInputs,
    signingSecret,
    verificationBundleSha256,
  });
  if (!verifyPhdCampaignReport(report, signingSecret)) {
    throw new Error('refusing to persist an invalid verified campaign report');
  }
  const verifiedReportCanonical = canonicalJson(report);
  const verifiedBundleCanonical = canonicalJson(verificationInputs);
  if (bundlePath !== null) {
    if (typeof bundlePath !== 'string'
        || bundlePath.length < 1
        || path.resolve(bundlePath) === path.resolve(reportPath)) {
      throw new Error('campaign bundle and report publication targets must be distinct');
    }
    atomicWriteAuthenticatedJson(bundlePath, verificationInputs, {
      authenticate: (candidate) => {
        try {
          const recomputed = verifyPhdCampaign({
            ...candidate,
            signingSecret,
            evaluatedAt: report.evaluatedAt,
            verificationBundleSha256:
              phdCampaignVerificationBundleSha256(candidate),
          });
          return canonicalJson(candidate) === verifiedBundleCanonical
            && phdCampaignVerificationBundleSha256(candidate)
              === verificationBundleSha256
            && canonicalJson(recomputed) === verifiedReportCanonical;
        } catch {
          return false;
        }
      },
      crashInjector: crashInjector === null ? null : (phase) => (
        crashInjector(`bundle_${phase}`)
      ),
      fixtureOnly,
    });
  }
  atomicWriteSignedControlPlaneRecord(reportPath, report, signingSecret, {
    authenticate: (candidate) => (
      verifyPhdCampaignReport(candidate, signingSecret)
      && canonicalJson(candidate) === verifiedReportCanonical
    ),
    crashInjector: crashInjector === null ? null : (phase) => (
      crashInjector(bundlePath === null ? phase : `report_${phase}`)
    ),
    fixtureOnly,
  });
  return consumePublishedPhdCampaignPair({
    bundlePath,
    crashInjector,
    fixtureOnly,
    report,
    reportPath,
    signingSecret,
    verificationInputs,
    verificationBundleSha256,
  });
}
