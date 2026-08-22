import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { sha256Bytes, sha256Text } from './hash.mjs';

export const RESEARCH_REVIEW_REQUEST_SCHEMA =
  'cortex.learning_os.research_review_authority_request.v2';
export const RESEARCH_REVIEW_REQUEST_BINDING_SCHEMA =
  'cortex.learning_os.research_review_request_binding.v1';

const DIGEST = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const TRUTH_BOUNDARY =
  'This exact request binds authenticated candidate bytes and bounded review scope; it does not perform or attest independent review.';
const REQUEST_KEYS = Object.freeze([
  'schemaVersion',
  'requestedCapability',
  'unsigned',
  'selfAttestation',
  'campaignId',
  'requestJobId',
  'requestJobSha256',
  'requestSessionId',
  'fixtureOnly',
  'candidateBinding',
  'boundedClaim',
  'corpusDigest',
  'assumptionsDigest',
  'claimSemanticsSha256',
  'authorityAttestation',
  'truthBoundary',
]);
const CANDIDATE_BINDING_KEYS = Object.freeze([
  'jobId',
  'candidateSessionId',
  'outputSha256',
  'artifact',
  'artifactDigest',
  'result',
  'resultDigest',
  'harvestedAuthority',
]);
const TASK_KEYS = Object.freeze([
  'schemaVersion',
  'campaignId',
  'candidateJobId',
  'candidateSessionId',
  'candidatePromptSha256',
  'fixtureOnly',
  'boundedClaim',
  'corpusDigest',
  'assumptionsDigest',
  'claimSemanticsSha256',
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isRecord(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function digest(value) {
  return sha256Text(canonicalJson(value));
}

export function validateResearchReviewCandidateBinding(binding) {
  return exactKeys(binding, CANDIDATE_BINDING_KEYS)
    && ID.test(String(binding.jobId || ''))
    && ID.test(String(binding.candidateSessionId || ''))
    && DIGEST.test(String(binding.outputSha256 || ''))
    && isRecord(binding.artifact)
    && binding.artifactDigest === digest(binding.artifact)
    && Object.hasOwn(binding, 'result')
    && binding.resultDigest === digest(binding.result)
    && binding.harvestedAuthority === 'worker_evidence_only';
}

export function validateResearchReviewRequestTask(task) {
  return exactKeys(task, TASK_KEYS)
    && task.schemaVersion === 'cortex.learning_os.research_review_request_task.v1'
    && ID.test(String(task.campaignId || ''))
    && ID.test(String(task.candidateJobId || ''))
    && ID.test(String(task.candidateSessionId || ''))
    && DIGEST.test(String(task.candidatePromptSha256 || ''))
    && typeof task.fixtureOnly === 'boolean'
    && typeof task.boundedClaim === 'string'
    && task.boundedClaim.length >= 1
    && task.boundedClaim.length <= 16 * 1024
    && DIGEST.test(String(task.corpusDigest || ''))
    && DIGEST.test(String(task.assumptionsDigest || ''))
    && (task.fixtureOnly
      ? task.claimSemanticsSha256 === null
        || DIGEST.test(String(task.claimSemanticsSha256 || ''))
      : DIGEST.test(String(task.claimSemanticsSha256 || '')));
}

export function validateResearchReviewAuthorityRequest(request) {
  return exactKeys(request, REQUEST_KEYS)
    && request.schemaVersion === RESEARCH_REVIEW_REQUEST_SCHEMA
    && request.requestedCapability === 'research_review'
    && request.unsigned === true
    && request.selfAttestation === false
    && ID.test(String(request.campaignId || ''))
    && ID.test(String(request.requestJobId || ''))
    && DIGEST.test(String(request.requestJobSha256 || ''))
    && ID.test(String(request.requestSessionId || ''))
    && typeof request.fixtureOnly === 'boolean'
    && validateResearchReviewCandidateBinding(request.candidateBinding)
    && typeof request.boundedClaim === 'string'
    && request.boundedClaim.length >= 1
    && request.boundedClaim.length <= 16 * 1024
    && DIGEST.test(String(request.corpusDigest || ''))
    && DIGEST.test(String(request.assumptionsDigest || ''))
    && (request.fixtureOnly
      ? request.claimSemanticsSha256 === null
        || DIGEST.test(String(request.claimSemanticsSha256 || ''))
      : DIGEST.test(String(request.claimSemanticsSha256 || '')))
    && request.authorityAttestation === null
    && request.truthBoundary === TRUTH_BOUNDARY;
}

export function createResearchReviewAuthorityRequest({
  job,
  candidateBinding,
} = {}) {
  const task = job?.task;
  if (!validateResearchReviewRequestTask(task)
      || job?.role !== 'research_review_request'
      || job?.executor !== 'authority_request_materialization'
      || !Array.isArray(job.dependencies)
      || job.dependencies.length !== 1
      || job.dependencies[0] !== task.candidateJobId
      || job.campaignId !== task.campaignId
      || task.candidateJobId !== candidateBinding?.jobId
      || task.candidateSessionId !== candidateBinding?.candidateSessionId) {
    throw new Error('research review request job or candidate dependency is invalid');
  }
  const request = {
    schemaVersion: RESEARCH_REVIEW_REQUEST_SCHEMA,
    requestedCapability: 'research_review',
    unsigned: true,
    selfAttestation: false,
    campaignId: job.campaignId,
    requestJobId: job.jobId,
    requestJobSha256: digest(job),
    requestSessionId: job.sessionId,
    fixtureOnly: task.fixtureOnly,
    candidateBinding: structuredClone(candidateBinding),
    boundedClaim: task.boundedClaim,
    corpusDigest: task.corpusDigest,
    assumptionsDigest: task.assumptionsDigest,
    claimSemanticsSha256: task.claimSemanticsSha256,
    authorityAttestation: null,
    truthBoundary: TRUTH_BOUNDARY,
  };
  if (!validateResearchReviewAuthorityRequest(request)) {
    throw new Error('research review authority request scope is invalid');
  }
  return request;
}

export function serializeResearchReviewAuthorityRequest(request) {
  if (!validateResearchReviewAuthorityRequest(request)) {
    throw new Error('research review authority request schema is invalid');
  }
  return Buffer.from(canonicalJson(request), 'utf8');
}

export function parseResearchReviewAuthorityRequestBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 4 * 1024 * 1024) {
    throw new Error('research review authority request bytes are invalid');
  }
  let request;
  try {
    request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('research review authority request is not strict UTF-8 JSON');
  }
  const canonicalBytes = serializeResearchReviewAuthorityRequest(request);
  if (!canonicalBytes.equals(bytes)) {
    throw new Error('research review authority request is not the canonical exact byte form');
  }
  return {
    request,
    bytes: Buffer.from(bytes),
    requestSha256: sha256Bytes(bytes),
  };
}

export function validateResearchReviewResult(result) {
  return exactKeys(result, ['status', 'adversarial', 'findings'])
    && result.status === 'passed'
    && result.adversarial === true
    && Array.isArray(result.findings);
}

function canonicalTimestamp(timestamp) {
  const milliseconds = Date.parse(String(timestamp || ''));
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === timestamp;
}

export function createResearchReviewRequestBinding({
  requestBytes,
  requestJobDigest,
  requestStartedAt,
  requestCompletedAt,
} = {}) {
  const parsed = parseResearchReviewAuthorityRequestBytes(requestBytes);
  const binding = {
    schemaVersion: RESEARCH_REVIEW_REQUEST_BINDING_SCHEMA,
    requestBytesBase64: parsed.bytes.toString('base64'),
    requestSha256: parsed.requestSha256,
    requestJobId: parsed.request.requestJobId,
    requestJobDigest,
    requestSessionId: parsed.request.requestSessionId,
    requestStartedAt,
    requestCompletedAt,
  };
  if (!validateResearchReviewRequestBinding(binding)) {
    throw new Error('research review request harvest binding is invalid');
  }
  return binding;
}

export function validateResearchReviewRequestBinding(binding) {
  if (!exactKeys(binding, [
    'schemaVersion', 'requestBytesBase64', 'requestSha256', 'requestJobId',
    'requestJobDigest', 'requestSessionId', 'requestStartedAt', 'requestCompletedAt',
  ])
      || binding.schemaVersion !== RESEARCH_REVIEW_REQUEST_BINDING_SCHEMA
      || typeof binding.requestBytesBase64 !== 'string'
      || !DIGEST.test(String(binding.requestSha256 || ''))
      || !ID.test(String(binding.requestJobId || ''))
      || !DIGEST.test(String(binding.requestJobDigest || ''))
      || !ID.test(String(binding.requestSessionId || ''))
      || !canonicalTimestamp(binding.requestStartedAt)
      || !canonicalTimestamp(binding.requestCompletedAt)
      || Date.parse(binding.requestCompletedAt) < Date.parse(binding.requestStartedAt)) {
    return false;
  }
  try {
    const bytes = Buffer.from(binding.requestBytesBase64, 'base64');
    const parsed = parseResearchReviewAuthorityRequestBytes(bytes);
    return bytes.toString('base64') === binding.requestBytesBase64
      && parsed.requestSha256 === binding.requestSha256
      && parsed.request.requestJobId === binding.requestJobId
      && parsed.request.requestJobSha256 === binding.requestJobDigest
      && parsed.request.requestSessionId === binding.requestSessionId;
  } catch {
    return false;
  }
}
