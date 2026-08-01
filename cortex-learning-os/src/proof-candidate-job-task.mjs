import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { sha256Text } from './hash.mjs';
import {
  createProofCandidate,
  parseProofRecordBytes,
  serializeProofRecord,
  validateProofTask,
} from './lean-proof-verifier.mjs';

export const PROOF_CANDIDATE_JOB_TASK_SCHEMA =
  'cortex.learning_os.proof_candidate_job_task.v1';
export const DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA =
  'cortex.learning_os.proof_candidate_job_task.v2';
export const RESEARCH_ARTIFACT_SOURCE_SCHEMA =
  'cortex.learning_os.research_artifact_source.v1';
export const PROOF_REPLAY_REQUEST_SCHEMA =
  'cortex.learning_os.proof_replay_request.v2';

const DIGEST = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isRecord(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

export function createResearchArtifactSource({
  dependencyJobId,
  candidateSessionId,
  candidatePromptSha256,
} = {}) {
  const source = {
    schemaVersion: RESEARCH_ARTIFACT_SOURCE_SCHEMA,
    dependencyJobId,
    candidateSessionId,
    candidatePromptSha256,
    artifactProjection: 'sha256(canonical-json(output.artifact))',
  };
  if (!validateResearchArtifactSource(source)) {
    throw new Error('research artifact source declaration is invalid');
  }
  return source;
}

export function validateResearchArtifactSource(source) {
  return exactKeys(source, [
    'artifactProjection', 'candidatePromptSha256', 'candidateSessionId',
    'dependencyJobId', 'schemaVersion',
  ])
    && source.schemaVersion === RESEARCH_ARTIFACT_SOURCE_SCHEMA
    && ID.test(String(source.dependencyJobId || ''))
    && ID.test(String(source.candidateSessionId || ''))
    && DIGEST.test(String(source.candidatePromptSha256 || ''))
    && source.artifactProjection === 'sha256(canonical-json(output.artifact))';
}

export function createProofCandidateJobTask({
  obligationId,
  taskBytes,
  trustedTemplateBytes,
  replaySessionId,
  claimSemanticsSha256 = null,
  researchArtifactDigest = null,
  researchArtifactSource = null,
} = {}) {
  const taskEnvelope = parseProofRecordBytes(taskBytes, 'proof candidate job task');
  const templateBytes = Buffer.from(trustedTemplateBytes || '');
  const dependent = researchArtifactSource !== null;
  const task = {
    schemaVersion: dependent
      ? DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA
      : PROOF_CANDIDATE_JOB_TASK_SCHEMA,
    obligationId,
    taskBytesBase64: Buffer.from(taskBytes || '').toString('base64'),
    taskBytesSha256: taskEnvelope.bytesSha256,
    trustedTemplateBase64: templateBytes.toString('base64'),
    trustedTemplateSha256: sha256Text(templateBytes),
    theoremStatementSha256: taskEnvelope.record.theorem.statementSha256,
    replaySessionId,
    claimSemanticsSha256,
    researchArtifactDigest,
    ...(dependent ? {
      researchArtifactSource: structuredClone(researchArtifactSource),
    } : {}),
  };
  const validation = validateProofCandidateJobTask(task);
  if (!validation.ok) {
    throw new Error(`invalid proof candidate job task: ${validation.errors.join('; ')}`);
  }
  return task;
}

export function validateProofCandidateJobTask(task) {
  const errors = [];
  const dependent = task?.schemaVersion === DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA;
  const expectedKeys = [
    'claimSemanticsSha256', 'obligationId', 'replaySessionId',
    'researchArtifactDigest', 'schemaVersion', 'taskBytesBase64',
    'taskBytesSha256', 'theoremStatementSha256', 'trustedTemplateBase64',
    'trustedTemplateSha256',
    ...(dependent ? ['researchArtifactSource'] : []),
  ];
  if (!exactKeys(task, expectedKeys)
      || ![
        PROOF_CANDIDATE_JOB_TASK_SCHEMA,
        DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA,
      ].includes(task?.schemaVersion)
      || !ID.test(String(task?.obligationId || ''))
      || !ID.test(String(task?.replaySessionId || ''))
      || !DIGEST.test(String(task?.taskBytesSha256 || ''))
      || !DIGEST.test(String(task?.trustedTemplateSha256 || ''))
      || !DIGEST.test(String(task?.theoremStatementSha256 || ''))
      || (task?.claimSemanticsSha256 !== null
        && !DIGEST.test(String(task.claimSemanticsSha256 || '')))
      || (task?.researchArtifactDigest !== null
        && !DIGEST.test(String(task.researchArtifactDigest || '')))
      || (dependent && (
        task.obligationId !== 'formal-proof-research-main-result'
        || !DIGEST.test(String(task.claimSemanticsSha256 || ''))
        || task.researchArtifactDigest !== null
        || !validateResearchArtifactSource(task.researchArtifactSource)
      ))) {
    errors.push('proof candidate task fields or dependent artifact source are invalid');
    return { ok: false, errors };
  }
  try {
    const taskBytes = Buffer.from(task.taskBytesBase64 || '', 'base64');
    const templateBytes = Buffer.from(task.trustedTemplateBase64 || '', 'base64');
    const envelope = parseProofRecordBytes(taskBytes, 'proof candidate job task');
    if (taskBytes.toString('base64') !== task.taskBytesBase64
        || templateBytes.toString('base64') !== task.trustedTemplateBase64
        || !validateProofTask(envelope.record).ok
        || envelope.record.conceptId !== task.obligationId
        || envelope.bytesSha256 !== task.taskBytesSha256
        || sha256Text(templateBytes) !== task.trustedTemplateSha256
        || envelope.record.theorem.templateSha256 !== task.trustedTemplateSha256
        || envelope.record.theorem.statementSha256 !== task.theoremStatementSha256) {
      errors.push('proof candidate exact task or template bytes are invalid');
    }
  } catch (error) {
    errors.push(error.message);
  }
  return { ok: errors.length === 0, errors };
}

export function proofCandidateTaskId(task) {
  const validation = validateProofCandidateJobTask(task);
  if (!validation.ok) {
    throw new Error(`invalid proof candidate job task: ${validation.errors.join('; ')}`);
  }
  return parseProofRecordBytes(
    Buffer.from(task.taskBytesBase64, 'base64'),
    'proof candidate job task identity',
  ).record.taskId;
}

export function materializeResearchArtifactDigest(task, dependencyBinding = null) {
  const validation = validateProofCandidateJobTask(task);
  if (!validation.ok) {
    throw new Error(`invalid proof candidate job task: ${validation.errors.join('; ')}`);
  }
  if (task.schemaVersion === PROOF_CANDIDATE_JOB_TASK_SCHEMA) {
    return task.researchArtifactDigest;
  }
  const source = task.researchArtifactSource;
  if (!isRecord(dependencyBinding)
      || dependencyBinding.jobId !== source.dependencyJobId
      || dependencyBinding.candidateSessionId !== source.candidateSessionId
      || !DIGEST.test(String(dependencyBinding.outputSha256 || ''))
      || !DIGEST.test(String(dependencyBinding.artifactDigest || ''))
      || dependencyBinding.artifactDigest
        !== sha256Text(canonicalJson(dependencyBinding.artifact))) {
    throw new Error('dependent proof task research artifact materialization is invalid');
  }
  return dependencyBinding.artifactDigest;
}

export function createProofCandidateReplayMaterialization({
  job,
  outputBytes,
  dependencyBinding = null,
} = {}) {
  if (job?.role !== 'proof_candidate') {
    throw new Error('proof replay materialization requires a proof candidate job');
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(outputBytes || '').toString('utf8'));
  } catch {
    parsed = null;
  }
  const taskBytes = Buffer.from(job.task?.taskBytesBase64 || '', 'base64');
  const taskValidation = validateProofCandidateJobTask(job.task);
  if (!taskValidation.ok || typeof parsed?.proofTerm !== 'string') {
    throw new Error('proof candidate output cannot be bound to the exact frozen task');
  }
  const researchArtifactDigest = materializeResearchArtifactDigest(
    job.task,
    dependencyBinding,
  );
  const candidate = createProofCandidate({
    taskBytes,
    candidateId: `${job.jobId}.candidate`,
    proofTerm: parsed.proofTerm,
  });
  const candidateBytes = serializeProofRecord(candidate);
  return {
    candidateBytes,
    replayRequest: {
      schemaVersion: PROOF_REPLAY_REQUEST_SCHEMA,
      requestedCapability: 'proof_replay',
      unsigned: true,
      selfAttestation: false,
      jobId: job.jobId,
      campaignId: job.campaignId,
      obligationId: job.task.obligationId,
      replaySessionId: job.task.replaySessionId,
      deploymentDigest: sha256Text(canonicalJson(job.deployment)),
      trustPolicyDigest: job.deployment?.contentDigests?.['trust-policy'],
      proofRuntimeProductDigest: job.deployment?.contentDigests?.['proof-runtime-product'],
      proofTaskSha256: sha256Text(canonicalJson(job.task)),
      taskBytesBase64: job.task.taskBytesBase64,
      taskBytesSha256: job.task.taskBytesSha256,
      candidateBytesBase64: candidateBytes.toString('base64'),
      candidateBytesSha256: sha256Text(candidateBytes),
      trustedTemplateBase64: job.task.trustedTemplateBase64,
      trustedTemplateSha256: job.task.trustedTemplateSha256,
      theoremStatementSha256: job.task.theoremStatementSha256,
      claimSemanticsSha256: job.task.claimSemanticsSha256,
      researchArtifactDigest,
      kernelEvidence: null,
      authorityReplayEvidence: null,
      replayAuthorityAttestation: null,
      truthBoundary: 'Candidate bytes are inert. Protected pinned-Lean execution and independent replay authority remain required.',
    },
  };
}
