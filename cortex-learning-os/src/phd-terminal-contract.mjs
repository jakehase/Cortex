import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  deploymentBindingDigest,
  isModelExecutableDeploymentBinding,
} from './deployment-identity.mjs';
import {
  executionSourceSha256,
  validateExecutionEvidenceRecord,
  verifyExecutionEvidenceBytes,
} from './execution-evidence.mjs';
import { sha256Bytes, sha256Text } from './hash.mjs';
import {
  proofCandidateTaskId,
  validateProofCandidateJobTask,
} from './proof-candidate-job-task.mjs';

const MODEL_CALL_KEYS = Object.freeze([
  'schemaVersion', 'jobId', 'jobDigest', 'role', 'command', 'args',
  'plannedSessionId', 'providerRequestId', 'providerSessionId',
  'provider', 'model', 'thinking', 'sandbox', 'toolsAllowed', 'toolsUsed',
  'usage', 'positiveUsage', 'isolatedDirectory', 'exactPromptBytes',
  'promptSha256', 'outputSha256', 'rawEventLedgerSha256',
  'executionIdentity', 'notBefore', 'startedAt', 'completedAt', 'expiresAt',
  'executionIntervalSha256', 'exitCode', 'signal', 'error',
  'postprocessError', 'evidenceError', 'stderrSha256',
  'executionEvidenceCore', 'executionEvidenceSha256', 'attestation',
  'provenanceStatus',
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

function expectedTaskIdentity(job) {
  let proofTaskId = null;
  if (validateProofCandidateJobTask(job.task).ok) {
    proofTaskId = proofCandidateTaskId(job.task);
  }
  return {
    taskId: job.task?.signedTask?.taskId
      || job.task?.taskId
      || proofTaskId
      || job.task?.examId
      || null,
    candidateId: job.task?.signedTask?.subjectId
      || job.task?.release?.subjectId
      || null,
  };
}

export function validatePhdModelCallTerminal({
  job,
  call,
  jobDigest,
  executionIdentity,
  startedAt,
  completedAt,
  executionIntervalSha256,
  outputBytes,
  rawEventLedgerBytes,
  rawStderrBytes,
} = {}) {
  const errors = [];
  if (!isRecord(job) || !isRecord(call)
      || !Buffer.isBuffer(outputBytes)
      || !Buffer.isBuffer(rawEventLedgerBytes)
      || !Buffer.isBuffer(rawStderrBytes)) {
    return { ok: false, errors: ['terminal model-call contract inputs are incomplete'] };
  }
  let taskIdentity;
  try {
    taskIdentity = expectedTaskIdentity(job);
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
  const expectedRequestedCommand = [call.command, ...(call.args || [])];
  const descriptorExecution = isModelExecutableDeploymentBinding(job.deployment);
  const expectedExecutedCommand = descriptorExecution
    ? ['/proc/self/fd/3', ...(call.args || [])]
    : expectedRequestedCommand;
  const approvedExecutable = job.deployment?.approvedModelExecutable;
  const core = call.executionEvidenceCore;
  const evidenceValidation = validateExecutionEvidenceRecord({
    core,
    executionEvidenceSha256: call.executionEvidenceSha256,
  });
  const evidenceBytesValidation = evidenceValidation.ok
    ? verifyExecutionEvidenceBytes(core, {
      inputBytes: Buffer.from(job.promptBase64 || '', 'base64'),
      rawOutputs: {
        stdout: rawEventLedgerBytes,
        stderr: rawStderrBytes,
      },
      outputFiles: {
        'output.json': outputBytes,
      },
    })
    : evidenceValidation;
  errors.push(...evidenceValidation.errors, ...evidenceBytesValidation.errors);

  if (!exactKeys(call, MODEL_CALL_KEYS)
      || call.schemaVersion !== 'cortex.learning_os.phd_worker_call.v2') {
    errors.push('terminal model-call fields or schema are invalid');
  }
  if (call.jobId !== job.jobId
      || call.jobDigest !== jobDigest
      || call.role !== job.role
      || call.plannedSessionId !== job.sessionId
      || call.provider !== job.modelRuntime?.provider
      || call.model !== job.modelRuntime?.model
      || call.thinking !== 'xhigh'
      || call.sandbox !== 'read-only'
      || call.toolsAllowed !== false
      || !Array.isArray(call.toolsUsed) || call.toolsUsed.length !== 0
      || call.positiveUsage !== true
      || call.isolatedDirectory !== true
      || call.exactPromptBytes !== true
      || call.promptSha256 !== job.promptSha256
      || call.outputSha256 !== sha256Bytes(outputBytes)
      || call.rawEventLedgerSha256 !== sha256Bytes(rawEventLedgerBytes)
      || call.stderrSha256 !== sha256Bytes(rawStderrBytes)
      || canonicalJson(call.executionIdentity) !== canonicalJson(executionIdentity)
      || call.notBefore !== job.notBefore
      || call.startedAt !== startedAt
      || call.completedAt !== completedAt
      || call.expiresAt !== job.expiresAt
      || call.executionIntervalSha256 !== executionIntervalSha256
      || call.exitCode !== 0
      || call.signal !== null
      || call.error !== null
      || call.postprocessError !== null
      || call.evidenceError !== null
      || call.attestation !== null
      || call.provenanceStatus !== 'awaiting_trusted_runner_attestation') {
    errors.push('terminal model-call semantic, timing, usage, or byte identity is invalid');
  }
  if (canonicalJson(core?.bindings) !== canonicalJson({
    candidateId: taskIdentity.candidateId,
    candidateSessionId: job.sessionId,
    candidateSha256: sha256Bytes(outputBytes),
    taskId: taskIdentity.taskId,
    taskSha256: digest(job.task),
    jobId: job.jobId,
    jobSha256: digest(job),
    campaignId: job.campaignId,
    campaignSha256: job.campaignDigest,
    deploymentSha256: deploymentBindingDigest(job.deployment),
    sourceSha256: executionSourceSha256(job.deployment),
  })
      || canonicalJson(core?.environment?.declared) !== canonicalJson({
        executionKind: 'host_process',
        role: job.role,
        modelRuntime: job.modelRuntime,
      })
      || canonicalJson(core?.command?.requestedArgv)
        !== canonicalJson(expectedRequestedCommand)
      || canonicalJson(core?.command?.executedArgv)
        !== canonicalJson(expectedExecutedCommand)
      || core?.process?.startedAt !== call.startedAt
      || core?.process?.completedAt !== call.completedAt
      || core?.process?.exitCode !== call.exitCode
      || core?.process?.signal !== call.signal
      || core?.process?.error !== call.error
      || canonicalJson(core?.model) !== canonicalJson({
        provider: call.provider,
        model: call.model,
        thinking: call.thinking,
        sandbox: call.sandbox,
        toolsAllowed: call.toolsAllowed,
        toolsUsed: call.toolsUsed,
        usage: call.usage,
        providerRequestId: call.providerRequestId,
        providerSessionId: call.providerSessionId,
        plannedSessionId: call.plannedSessionId,
      })) {
    errors.push('terminal model-call execution core is detached from its exact job or runtime');
  }
  if (job.deployment?.executionClosure?.immutable === true && !descriptorExecution) {
    errors.push('immutable terminal model-call deployment omits an approved executable');
  }
  if (descriptorExecution
      && (call.command !== approvedExecutable?.path
        || core?.command?.executable?.invoked !== approvedExecutable?.path
        || core?.command?.executable?.resolvedPath !== '/proc/self/fd/3'
        || core?.command?.executable?.bytes !== approvedExecutable?.bytes
        || core?.command?.executable?.sha256 !== approvedExecutable?.sha256)) {
    errors.push('terminal model-call approved executable or descriptor execution differs');
  }
  return { ok: errors.length === 0, errors };
}
