#!/usr/bin/env node
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  approvedExecutableStdio,
  openApprovedModelExecutable,
} from './approved-model-executable.mjs';
import {
  deploymentBindingDigest,
  isFrozenDeploymentBinding,
  isModelExecutableDeploymentBinding,
  validateDeploymentBinding,
} from './deployment-identity.mjs';
import {
  createExecutionEvidenceCore,
  executionEvidenceSha256,
  executionSourceSha256,
  observeExecutableIdentity,
  observeProcessEnvironment,
} from './execution-evidence.mjs';
import {
  executeFrozenResearchReproduction,
  serializeResearchReproductionAuthorityRequest,
} from './frozen-research-reproduction.mjs';
import { assertExecutionClosureAtRoot } from './git-product-source.mjs';
import { sha256File, sha256Text } from './hash.mjs';
import {
  parseProofRecordBytes,
  validateProofTask,
} from './lean-proof-verifier.mjs';
import { observedToolEvents } from './model-answer-runner.mjs';
import { CLOS_ROOT } from './paths.mjs';
import {
  createPhdWorkerBlocker,
  PHD_WORKER_SUMMARY_SCHEMA,
} from './phd-worker-terminal-contract.mjs';
import {
  createResearchReviewAuthorityRequest,
  serializeResearchReviewAuthorityRequest,
} from './research-review-request.mjs';
import {
  createProofCandidateReplayMaterialization,
  DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA,
  materializeResearchArtifactDigest,
  proofCandidateTaskId,
  validateProofCandidateJobTask,
} from './proof-candidate-job-task.mjs';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
};
const jobPath = value('--job');
const expectedJobFileSha256 = value('--expected-job-file-sha256');
const expectedPlanDigest = value('--plan-digest');
const expectedCampaignDigest = value('--campaign-digest');
const expectedDescriptorSetSha256 = value('--descriptor-set-sha256');
const expectedProductTree = value('--product-tree');
const expectedRuntimeSha256 = value('--runtime-sha256');
const expectedClosureSha256 = value('--closure-sha256');
const checkoutRootArgument = value('--checkout-root');
const checkoutRoot = checkoutRootArgument ? path.resolve(checkoutRootArgument) : null;
const artifactRootArgument = value('--artifact-root');
const artifactRoot = artifactRootArgument ? path.resolve(artifactRootArgument) : null;
const dependencyRootArgument = value('--dependency-root');
const dependencyRoot = dependencyRootArgument
  ? path.resolve(dependencyRootArgument)
  : (artifactRoot ? path.dirname(artifactRoot) : null);
const jobRootArgument = value('--job-root');
const jobRoot = jobRootArgument ? path.resolve(jobRootArgument) : null;
const codexCommandOverride = value('--codex-command');

function isRecord(candidate) {
  return Boolean(candidate) && typeof candidate === 'object' && !Array.isArray(candidate);
}

function exactKeys(candidate, keys) {
  return isRecord(candidate)
    && Object.keys(candidate).sort().join(',') === [...keys].sort().join(',');
}

function parseEvents(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { type: 'unparsed_output', text: line }; }
  });
}

function usage(events) {
  return [...events].reverse().map((event) => event?.usage || event?.item?.usage).find(Boolean) || null;
}

function observedIdentity(events, names) {
  for (const event of events) {
    const records = [event, event?.item, event?.response, event?.request].filter(Boolean);
    for (const record of records) {
      for (const name of names) {
        const value = record?.[name];
        if (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
          return value;
        }
      }
    }
  }
  return null;
}

function positiveUsage(value) {
  return value && typeof value === 'object' && Object.entries(value).some(([key, amount]) => (
    /(?:token|input|output|total)/i.test(key) && Number(amount) > 0
  ));
}

function allFiles(root) {
  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('worker artifact contains a symlink');
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) found.push(target);
    }
  };
  walk(root);
  return found;
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(
    directory,
    fs.constants.O_RDONLY
      | (fs.constants.O_DIRECTORY || 0)
      | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function durableExclusiveWrite(target, bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error('worker publication requires exact bytes');
  const directory = path.dirname(target);
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(16).toString('hex')}.tmp`,
  );
  let descriptor = null;
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | (fs.constants.O_NOFOLLOW || 0)
        | (fs.constants.O_CLOEXEC || 0),
      0o600,
    );
    let offset = 0;
    while (offset < bytes.length) {
      offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
    }
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    if (fs.existsSync(target)) throw new Error(`worker artifact already exists: ${target}`);
    fs.renameSync(temporary, target);
    fsyncDirectory(directory);
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function write(target, value) {
  durableExclusiveWrite(
    target,
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'),
  );
}

function writeCanonical(target, value) {
  durableExclusiveWrite(target, Buffer.from(canonicalJson(value), 'utf8'));
}

function digest(value) {
  return sha256Text(canonicalJson(value));
}

function canonicalTimestamp(timestamp) {
  const milliseconds = Date.parse(String(timestamp || ''));
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === timestamp;
}

function executionInterval(job, startedAt, completedAt) {
  const interval = {
    jobDigest: digest(job),
    notBefore: job.notBefore,
    startedAt,
    completedAt,
    expiresAt: job.expiresAt,
  };
  return {
    ...interval,
    executionIntervalSha256: digest(interval),
    valid: canonicalTimestamp(startedAt)
      && canonicalTimestamp(completedAt)
      && canonicalTimestamp(job.notBefore)
      && canonicalTimestamp(job.expiresAt)
      && Date.parse(startedAt) >= Date.parse(job.notBefore)
      && Date.parse(completedAt) >= Date.parse(startedAt)
      && Date.parse(completedAt) <= Date.parse(job.expiresAt),
  };
}

function executionIdentity(job) {
  return {
    planDigest: expectedPlanDigest,
    campaignDigest: expectedCampaignDigest,
    descriptorSetSha256: expectedDescriptorSetSha256,
    productTree: expectedProductTree,
    runtimeSha256: expectedRuntimeSha256,
    closureSha256: expectedClosureSha256,
  };
}

function assertExecutionIdentity(job) {
  const identity = executionIdentity(job);
  const digests = [
    identity.planDigest,
    identity.campaignDigest,
    identity.descriptorSetSha256,
    identity.runtimeSha256,
    identity.closureSha256,
  ];
  if (!checkoutRoot
      || digests.some((entry) => !/^[0-9a-f]{64}$/.test(String(entry || '')))
      || !/^[0-9a-f]{40}$/.test(String(identity.productTree || ''))
      || job.campaignDigest !== identity.campaignDigest
      || !isFrozenDeploymentBinding(job.deployment)
      || job.deployment?.productTree !== identity.productTree
      || job.deployment?.runtimeSha256 !== identity.runtimeSha256
      || job.deployment?.closureSha256 !== identity.closureSha256) {
    throw new Error('worker plan, product tree, runtime, or closure identity mismatch');
  }
  assertExecutionClosureAtRoot(job.deployment.executionClosure, checkoutRoot);
  return identity;
}

function spawnCaptured(command, commandArgs, {
  input,
  maxBuffer,
  timeout,
  env,
  cwd,
  executableDescriptor = null,
} = {}) {
  return new Promise((resolve) => {
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let processError = null;
    let timer = null;
    const child = spawn(command, commandArgs, {
      stdio: executableDescriptor === null
        ? ['pipe', 'pipe', 'pipe']
        : approvedExecutableStdio(executableDescriptor),
      env,
      cwd,
    });
    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve({
        status,
        signal,
        error: processError,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    };
    const retain = (chunks, chunk, stream) => {
      if (stream === 'stdout') stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;
      if (stdoutBytes > maxBuffer || stderrBytes > maxBuffer) {
        processError = new Error(`qualification worker ${stream} exceeded maxBuffer`);
        child.kill('SIGKILL');
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on('data', (chunk) => retain(stdout, Buffer.from(chunk), 'stdout'));
    child.stderr.on('data', (chunk) => retain(stderr, Buffer.from(chunk), 'stderr'));
    child.on('error', (error) => {
      processError = error;
      finish(null, null);
    });
    child.on('close', finish);
    child.stdin.on('error', (error) => {
      processError = error;
      child.kill('SIGKILL');
    });
    child.stdin.end(input);
    timer = setTimeout(() => {
      processError = new Error('qualification worker command timed out');
      child.kill('SIGKILL');
    }, timeout);
    if (settled) clearTimeout(timer);
  });
}

function writeManifest(job, summary, binding) {
  const files = allFiles(artifactRoot)
    .filter((target) => path.basename(target) !== 'artifact-manifest.json')
    .map((target) => ({
      path: path.relative(artifactRoot, target),
      bytes: fs.statSync(target).size,
      ownerUid: 0,
      ownerGid: 0,
      mode: '0444',
      linkCount: 1,
      sha256: sha256File(target),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const directories = [];
  const walkDirectories = (directory) => {
    const childDirectories = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of childDirectories) {
      const target = path.join(directory, entry.name);
      const children = fs.readdirSync(target, { withFileTypes: true });
      directories.push({
        path: path.relative(artifactRoot, target),
        ownerUid: 0,
        ownerGid: 0,
        mode: '0555',
        linkCount: 2 + children.filter(
          (child) => child.isDirectory() && !child.isSymbolicLink(),
        ).length,
      });
      walkDirectories(target);
    }
  };
  walkDirectories(artifactRoot);
  write(path.join(artifactRoot, 'artifact-manifest.json'), {
    schemaVersion: 'cortex.learning_os.phd_worker_manifest.v3',
    jobId: job.jobId,
    campaignId: job.campaignId,
    jobDigest: summary.jobDigest,
    jobControlPlaneSignature: structuredClone(job.controlPlaneSignature),
    deployment: job.deployment,
    executor: job.executor,
    executionIdentity: binding,
    promptSha256: job.promptSha256,
    status: summary.status,
    notBefore: summary.notBefore,
    startedAt: summary.startedAt,
    completedAt: summary.completedAt,
    expiresAt: summary.expiresAt,
    executionIntervalSha256: summary.executionIntervalSha256,
    timingProvenance: summary.timingProvenance,
    outputSha256: summary.outputSha256,
    publication: {
      schemaVersion: 'cortex.learning_os.phd_terminal_publication.v1',
      publisherUid: 0,
      publisherGid: 0,
      rootMode: '0555',
      fileMode: '0444',
      directoryMode: '0555',
      regularFileLinkCount: 1,
      rootLinkCount: 2 + directories.filter((entry) => !entry.path.includes(path.sep)).length,
      producerWritableTerminal: false,
      noFollow: true,
      exactMetadata: true,
    },
    directories,
    files,
    authority: 'worker_evidence_only',
    truthBoundary: 'Remote worker artifacts cannot mutate or qualify canonical control-plane state.',
  });
}

function validateJob(job, executionStartedAt = null) {
  const deployment = validateDeploymentBinding(job?.deployment);
  if (!deployment.ok) throw new Error(`invalid job deployment: ${deployment.errors.join('; ')}`);
  if (!isFrozenDeploymentBinding(job.deployment)) {
    throw new Error('detached job does not bind a frozen execution closure');
  }
  const executor = job?.executor;
  const dependencies = job?.dependencies;
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
  const expiresAtMs = Date.parse(String(job?.expiresAt || ''));
  if (!exactKeys(job, [
    'schemaVersion', 'jobId', 'campaignId', 'campaignDigest', 'role', 'sessionId',
    'executor', 'dependencies', 'deployment', 'notBefore', 'expiresAt', 'promptBase64',
    'promptSha256', 'outputSchema', 'task', 'descriptorSha256', 'idempotencyKey',
    'modelRuntime', 'limits', 'canonicalStateAuthority', 'truthBoundary',
    'controlPlaneSignature',
  ])
      || job?.schemaVersion !== 'cortex.learning_os.phd_detached_job.v2'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(String(job.jobId || ''))
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(String(job.campaignId || ''))
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(String(job.sessionId || ''))
      || !/^[0-9a-f]{64}$/.test(String(job.campaignDigest || ''))
      || !canonicalTimestamp(job.notBefore)
      || !canonicalTimestamp(job.expiresAt)
      || Date.parse(job.expiresAt) <= Date.parse(job.notBefore)
      || (executionStartedAt !== null
        && (!canonicalTimestamp(executionStartedAt)
          || Date.parse(executionStartedAt) < Date.parse(job.notBefore)))
      || Date.now() > expiresAtMs
      || !['exam', 'proof_candidate', 'research_candidate', 'adversarial_review',
        'reproduction', 'formal_research_theorem', 'research_review_request',
        'retention'].includes(job.role)
      || !['model_no_tools', 'frozen_task_materialization',
        'authority_request_materialization', 'frozen_research_reproduction'].includes(executor)
      || (executor === 'frozen_task_materialization' && job.role !== 'formal_research_theorem')
      || (executor === 'authority_request_materialization' && job.role !== 'research_review_request')
      || (executor === 'frozen_research_reproduction' && job.role !== 'reproduction')
      || !Array.isArray(dependencies)
      || new Set(dependencies || []).size !== dependencies?.length
      || dependencies.some((dependency) => (
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(String(dependency || ''))
        || dependency === job.jobId
      ))
      || (executor === 'model_no_tools' && (
        !exactKeys(job.modelRuntime, ['provider', 'model', 'thinking', 'sandbox', 'toolsAllowed'])
        || job.modelRuntime?.provider !== 'openai-codex'
        || typeof job.modelRuntime?.model !== 'string' || job.modelRuntime.model.length < 1
        || job.modelRuntime?.thinking !== 'xhigh'
        || job.modelRuntime?.sandbox !== 'read-only'
        || job.modelRuntime?.toolsAllowed !== false
        || !/^[A-Za-z0-9._-]+[.]schema[.]json$/.test(String(job.outputSchema || ''))
        || (job.task !== null && !isRecord(job.task))
      ))
      || (executor !== 'model_no_tools' && (
        job.modelRuntime !== null || job.outputSchema !== null || !isRecord(job.task)
      ))
      || (executor === 'frozen_task_materialization'
        && (job.task?.researchArtifactSource === null
          ? dependencies.length !== 0
          : (dependencies.length !== 1
            || dependencies[0] !== job.task?.researchArtifactSource?.dependencyJobId)))
      || (['authority_request_materialization', 'frozen_research_reproduction'].includes(executor)
        && (dependencies.length !== 1 || job.task?.candidateJobId !== dependencies[0]))
      || !exactKeys(job.limits, ['timeoutSeconds', 'maxOutputBytes'])
      || !Number.isInteger(job.limits?.timeoutSeconds)
      || job.limits.timeoutSeconds < 30 || job.limits.timeoutSeconds > 3600
      || !Number.isInteger(job.limits?.maxOutputBytes)
      || job.limits.maxOutputBytes < 1024 || job.limits.maxOutputBytes > 16 * 1024 * 1024
      || typeof job.promptBase64 !== 'string'
      || !/^[0-9a-f]{64}$/.test(String(job.promptSha256 || ''))
      || !/^[0-9a-f]{64}$/.test(String(job.descriptorSha256 || ''))
      || !/^[0-9a-f]{64}$/.test(String(job.idempotencyKey || ''))
      || job.descriptorSha256 !== expectedDescriptorSha256
      || job.idempotencyKey !== expectedIdempotencyKey
      || job.canonicalStateAuthority !== false
      || typeof job.truthBoundary !== 'string' || job.truthBoundary.length < 20
      || !exactKeys(job.controlPlaneSignature, ['algorithm', 'digest', 'keyId'])
      || job.controlPlaneSignature?.algorithm !== 'hmac-sha256'
      || !/^[0-9a-f]{16}$/.test(String(job.controlPlaneSignature?.keyId || ''))
      || !/^[0-9a-f]{64}$/.test(String(job.controlPlaneSignature?.digest || ''))) {
    throw new Error('invalid detached qualification job');
  }
  const prompt = Buffer.from(job.promptBase64, 'base64');
  if (prompt.length < 1 || prompt.length > 1024 * 1024
      || prompt.toString('base64') !== job.promptBase64
      || sha256Text(prompt) !== job.promptSha256) {
    throw new Error('detached job exact prompt bytes mismatch');
  }
  let schemaPath = null;
  if (executor === 'model_no_tools') {
    schemaPath = path.join(CLOS_ROOT, 'schemas', job.outputSchema);
    if (!fs.existsSync(schemaPath) || path.dirname(schemaPath) !== path.join(CLOS_ROOT, 'schemas')) {
      throw new Error('detached job output schema is not allowlisted');
    }
  }
  return { prompt, schemaPath, executor };
}

function verifiedDependency(jobId) {
  const root = path.resolve(dependencyRoot, jobId);
  if (!root.startsWith(`${dependencyRoot}${path.sep}`)) {
    throw new Error('dependency artifact path escapes its root');
  }
  const storedJob = JSON.parse(fs.readFileSync(path.join(root, 'job.json'), 'utf8'));
  const plannedJobPath = path.resolve(jobRoot, `${jobId}.json`);
  if (!plannedJobPath.startsWith(`${jobRoot}${path.sep}`)) {
    throw new Error('dependency authenticated job path escapes its root');
  }
  const plannedJobStat = fs.lstatSync(plannedJobPath);
  if (!plannedJobStat.isFile() || plannedJobStat.isSymbolicLink()) {
    throw new Error(`dependency authenticated job is unsafe: ${jobId}`);
  }
  const plannedJob = JSON.parse(fs.readFileSync(plannedJobPath, 'utf8'));
  validateJob(plannedJob);
  const summary = JSON.parse(fs.readFileSync(path.join(root, 'worker-summary.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'artifact-manifest.json'), 'utf8'));
  const modelCall = JSON.parse(fs.readFileSync(path.join(root, 'model-call.json'), 'utf8'));
  const rootStat = fs.lstatSync(root);
  const fixtureTerminal = job.task?.fixtureOnly === true;
  const terminalUid = fixtureTerminal ? process.getuid() : 0;
  const terminalGid = fixtureTerminal ? process.getgid() : 0;
  const interval = executionInterval(
    storedJob,
    modelCall.startedAt,
    modelCall.completedAt,
  );
  const expectedResearchSource = job.task?.researchArtifactSource
    || job.task?.proofTask?.researchArtifactSource
    || {
      candidateSessionId: job.task?.candidateSessionId,
      candidatePromptSha256: job.task?.candidatePromptSha256,
    };
  if (storedJob.jobId !== jobId
      || canonicalJson(storedJob) !== canonicalJson(plannedJob)
      || storedJob.campaignId !== job.campaignId
      || storedJob.campaignDigest !== job.campaignDigest
      || canonicalJson(storedJob.deployment) !== canonicalJson(job.deployment)
      || storedJob.role !== 'research_candidate'
      || storedJob.sessionId !== expectedResearchSource?.candidateSessionId
      || storedJob.promptSha256 !== expectedResearchSource?.candidatePromptSha256
      || summary.schemaVersion !== 'cortex.learning_os.phd_worker_summary.v2'
      || summary.status !== 'candidate'
      || summary.jobDigest !== interval.jobDigest
      || summary.executor !== storedJob.executor
      || summary.startedAt !== modelCall.startedAt
      || summary.completedAt !== modelCall.completedAt
      || summary.expiresAt !== storedJob.expiresAt
      || summary.executionIntervalSha256 !== interval.executionIntervalSha256
      || summary.timingProvenance !== 'worker_observed_awaiting_execution_attestation'
      || !interval.valid
      || !rootStat.isDirectory() || rootStat.isSymbolicLink()
      || rootStat.uid !== terminalUid || rootStat.gid !== terminalGid
      || (rootStat.mode & 0o7777) !== 0o555
      || manifest.schemaVersion !== 'cortex.learning_os.phd_worker_manifest.v3'
      || manifest.jobId !== jobId
      || manifest.campaignId !== job.campaignId
      || manifest.jobDigest !== interval.jobDigest
      || canonicalJson(manifest.jobControlPlaneSignature)
        !== canonicalJson(storedJob.controlPlaneSignature)
      || canonicalJson(manifest.deployment) !== canonicalJson(storedJob.deployment)
      || manifest.executor !== storedJob.executor
      || canonicalJson(manifest.executionIdentity) !== canonicalJson(executionIdentity(job))
      || canonicalJson(summary.executionIdentity) !== canonicalJson(executionIdentity(job))
      || manifest.promptSha256 !== storedJob.promptSha256
      || manifest.status !== summary.status
      || manifest.startedAt !== summary.startedAt
      || manifest.completedAt !== summary.completedAt
      || manifest.expiresAt !== summary.expiresAt
      || manifest.executionIntervalSha256 !== summary.executionIntervalSha256
      || manifest.timingProvenance !== summary.timingProvenance
      || manifest.authority !== 'worker_evidence_only'
      || manifest.outputSha256 !== summary.outputSha256
      || modelCall.schemaVersion !== 'cortex.learning_os.phd_worker_call.v2'
      || modelCall.jobId !== storedJob.jobId
      || modelCall.jobDigest !== interval.jobDigest
      || modelCall.promptSha256 !== storedJob.promptSha256
      || modelCall.startedAt !== summary.startedAt
      || modelCall.completedAt !== summary.completedAt
      || modelCall.expiresAt !== storedJob.expiresAt
      || modelCall.executionIntervalSha256 !== interval.executionIntervalSha256
      || canonicalJson(modelCall.executionIdentity) !== canonicalJson(executionIdentity(job))
      || modelCall.rawEventLedgerSha256
        !== sha256File(path.join(root, 'raw-events.ndjson'))) {
    throw new Error(`research dependency is not a terminal bound candidate: ${jobId}`);
  }
  const manifested = new Set();
  for (const record of manifest.files || []) {
    const target = path.resolve(root, record.path);
    const targetStat = fs.lstatSync(target);
    if (!target.startsWith(`${root}${path.sep}`)
        || manifested.has(record.path)
        || !targetStat.isFile()
        || targetStat.isSymbolicLink()
        || targetStat.uid !== terminalUid || targetStat.gid !== terminalGid
        || (targetStat.mode & 0o7777) !== 0o444 || targetStat.nlink !== 1
        || record.ownerUid !== 0 || record.ownerGid !== 0
        || record.mode !== '0444' || record.linkCount !== 1
        || targetStat.size !== record.bytes
        || sha256File(target) !== record.sha256) {
      throw new Error(`research dependency manifest mismatch: ${jobId}`);
    }
    manifested.add(record.path);
  }
  const actual = allFiles(root)
    .filter((target) => path.basename(target) !== 'artifact-manifest.json')
    .map((target) => path.relative(root, target))
    .sort();
  if (canonicalJson([...manifested].sort()) !== canonicalJson(actual)) {
    throw new Error(`research dependency manifest is partial or has extra files: ${jobId}`);
  }
  const outputBytes = fs.readFileSync(path.join(root, 'output.json'));
  if (sha256Text(outputBytes) !== summary.outputSha256) {
    throw new Error(`research dependency output digest mismatch: ${jobId}`);
  }
  const output = JSON.parse(outputBytes.toString('utf8'));
  if (!output?.artifact || typeof output.artifact !== 'object'
      || !Object.hasOwn(output, 'result')) {
    throw new Error(`research dependency output shape is invalid: ${jobId}`);
  }
  return {
    jobId,
    candidateSessionId: storedJob.sessionId,
    outputSha256: summary.outputSha256,
    artifact: output.artifact,
    artifactDigest: digest(output.artifact),
    result: output.result,
    resultDigest: digest(output.result),
    harvestedAuthority: 'worker_evidence_only',
  };
}

async function runInertJob(job, executor, binding) {
  const startedAt = new Date().toISOString();
  const dependencyBindings = job.dependencies.map(verifiedDependency);
  let output;
  let exactOutputBytes = null;
  let mechanicallyValid = true;
  if (executor === 'frozen_task_materialization') {
    const binding = job.task?.proofTask;
    const taskBytes = Buffer.from(binding?.taskBytesBase64 || '', 'base64');
    const templateBytes = Buffer.from(binding?.trustedTemplateBase64 || '', 'base64');
    const taskEnvelope = parseProofRecordBytes(taskBytes, 'frozen materialization proof task');
    if (!validateProofTask(taskEnvelope.record).ok
        || taskEnvelope.bytesSha256 !== binding?.taskBytesSha256
        || sha256Text(templateBytes) !== binding?.trustedTemplateSha256
        || taskEnvelope.record.theorem.templateSha256 !== binding?.trustedTemplateSha256
        || taskEnvelope.record.theorem.statementSha256 !== binding?.theoremStatementSha256) {
      throw new Error('formal research theorem materialization binding is invalid');
    }
    const researchArtifactDigest = binding?.schemaVersion
      === DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA
      ? materializeResearchArtifactDigest(binding, dependencyBindings[0])
      : binding?.researchArtifactDigest ?? null;
    durableExclusiveWrite(path.join(artifactRoot, 'proof-task.bytes'), taskBytes);
    durableExclusiveWrite(path.join(artifactRoot, 'trusted-template.lean'), templateBytes);
    output = {
      schemaVersion: 'cortex.learning_os.formal_research_materialization.v1',
      obligationId: binding.obligationId,
      taskBytesSha256: binding.taskBytesSha256,
      trustedTemplateSha256: binding.trustedTemplateSha256,
      theoremStatementSha256: binding.theoremStatementSha256,
      claimSemanticsSha256: job.task.claimSemanticsSha256,
      researchArtifactDigest,
      researchArtifactSource: structuredClone(job.task.researchArtifactSource),
      dependencyOutputSha256: dependencyBindings[0]?.outputSha256 || null,
      unsigned: true,
      authority: 'worker_evidence_only',
      truthBoundary: 'Exact frozen theorem and task bytes are materialized only; no proof or correspondence is attested.',
    };
  } else if (executor === 'authority_request_materialization') {
    const candidateBinding = dependencyBindings[0];
    output = createResearchReviewAuthorityRequest({ job, candidateBinding });
    exactOutputBytes = serializeResearchReviewAuthorityRequest(output);
    durableExclusiveWrite(
      path.join(artifactRoot, 'research-review-authority-request.json'),
      exactOutputBytes,
    );
  } else if (executor === 'frozen_research_reproduction') {
    const executed = await executeFrozenResearchReproduction({
      task: job.task,
      artifactRoot,
      candidateBinding: dependencyBindings[0],
      executionBinding: {
        jobId: job.jobId,
        jobSha256: digest(job),
        campaignId: job.campaignId,
        campaignSha256: job.campaignDigest,
        deploymentSha256: deploymentBindingDigest(job.deployment),
      },
    });
    output = executed.request;
    mechanicallyValid = executed.matched;
    exactOutputBytes = serializeResearchReproductionAuthorityRequest(output);
    durableExclusiveWrite(
      path.join(artifactRoot, 'reproduction-authority-request.json'),
      exactOutputBytes,
    );
  } else {
    throw new Error('unsupported inert qualification executor');
  }
  const outputBytes = exactOutputBytes
    || Buffer.from(`${JSON.stringify(output, null, 2)}\n`, 'utf8');
  durableExclusiveWrite(path.join(artifactRoot, 'output.json'), outputBytes);
  const completedAt = new Date().toISOString();
  const interval = executionInterval(job, startedAt, completedAt);
  mechanicallyValid = mechanicallyValid && interval.valid;
  write(path.join(artifactRoot, 'execution-record.json'), {
    schemaVersion: 'cortex.learning_os.phd_inert_execution.v2',
    jobId: job.jobId,
    jobDigest: interval.jobDigest,
    role: job.role,
    executor,
    sessionId: job.sessionId,
    descriptorSha256: job.descriptorSha256,
    idempotencyKey: job.idempotencyKey,
    executionIdentity: binding,
    dependencyBindings: dependencyBindings.map((binding) => ({
      jobId: binding.jobId,
      outputSha256: binding.outputSha256,
      artifactDigest: binding.artifactDigest,
      resultDigest: binding.resultDigest,
    })),
    notBefore: job.notBefore,
    startedAt,
    completedAt,
    expiresAt: job.expiresAt,
    executionIntervalSha256: interval.executionIntervalSha256,
    outputSha256: sha256Text(outputBytes),
    authority: 'worker_evidence_only',
    canonicalStateMutated: false,
  });
  return {
    schemaVersion: PHD_WORKER_SUMMARY_SCHEMA,
    jobId: job.jobId,
    campaignId: job.campaignId,
    jobDigest: interval.jobDigest,
    executor,
    status: mechanicallyValid ? 'candidate' : 'failed',
    notBefore: job.notBefore,
    startedAt,
    completedAt,
    expiresAt: job.expiresAt,
    executionIntervalSha256: interval.executionIntervalSha256,
    timingProvenance: 'worker_observed_awaiting_execution_attestation',
    outputSha256: sha256Text(outputBytes),
    executionIdentity: binding,
    authority: 'worker_evidence_only',
    canonicalStateMutated: false,
    ...(mechanicallyValid ? {} : {
      blocker: createPhdWorkerBlocker({
        code: 'mechanically_invalid',
        phase: 'inert_execution',
        message: 'inert execution did not satisfy the exact frozen task',
      }),
    }),
    truthBoundary: mechanicallyValid
      ? 'Inert artifact is complete and awaits independent protected authority verification.'
      : 'Inert execution did not match the frozen task; no authority or qualification claim is allowed.',
  };
}

function materializeProofReplayRequest(job, outputBytes, dependencyBinding = null) {
  if (job.role !== 'proof_candidate') return;
  const materialized = createProofCandidateReplayMaterialization({
    job,
    outputBytes,
    dependencyBinding,
  });
  durableExclusiveWrite(
    path.join(artifactRoot, 'proof-candidate.bytes'),
    materialized.candidateBytes,
  );
  writeCanonical(
    path.join(artifactRoot, 'independent-replay-request.json'),
    materialized.replayRequest,
  );
}

let job;
let binding = null;
const workerStartedAt = new Date().toISOString();
try {
  if (!jobPath || !artifactRoot || !/^[0-9a-f]{64}$/.test(String(expectedJobFileSha256 || ''))
      || !checkoutRoot || !jobRoot) {
    throw new Error('job, authenticated plan/closure identity, checkout root, and artifact root are required');
  }
  const jobStat = fs.lstatSync(jobPath);
  if (!jobStat.isFile() || jobStat.isSymbolicLink()) throw new Error('job must be a regular file');
  const jobBytes = fs.readFileSync(jobPath);
  if (sha256Text(jobBytes) !== expectedJobFileSha256) {
    throw new Error('authenticated detached job bytes changed before execution');
  }
  job = JSON.parse(jobBytes.toString('utf8'));
  const { prompt, schemaPath, executor } = validateJob(job, workerStartedAt);
  binding = assertExecutionIdentity(job);
  const proofDependencyBinding = job.task?.schemaVersion
    === DEPENDENT_PROOF_CANDIDATE_JOB_TASK_SCHEMA
    ? verifiedDependency(job.task.researchArtifactSource.dependencyJobId)
    : null;
  const artifactStat = fs.lstatSync(artifactRoot);
  if (!artifactStat.isDirectory() || artifactStat.isSymbolicLink()
      || artifactStat.uid !== process.getuid()
      || artifactStat.gid !== process.getgid()
      || (artifactStat.mode & 0o7777) !== 0o700
      || fs.readdirSync(artifactRoot).length !== 0) {
    throw new Error('worker producer stage must be an empty identity-owned directory');
  }
  write(path.join(artifactRoot, 'job.json'), job);
  if (executor !== 'model_no_tools') {
    const summary = await runInertJob(job, executor, binding);
    write(path.join(artifactRoot, 'worker-summary.json'), summary);
    writeManifest(job, summary, binding);
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = summary.status === 'candidate' ? 0 : 4;
  } else {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-phd-worker-'));
  const lastMessage = path.join(temporary, 'last-message.json');
  try {
    const commandArgs = [
      'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules',
      '--sandbox', 'read-only', '--skip-git-repo-check',
      '--model', job.modelRuntime.model,
      '--config', 'model_reasoning_effort="xhigh"',
      '--cd', temporary,
      '--json', '--output-schema', schemaPath,
      '--output-last-message', lastMessage,
      '-',
    ];
    const processEnvironment = {
      LANG: 'C',
      LC_ALL: 'C',
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      CLOS_QUALIFICATION_SESSION_ID: job.sessionId,
    };
    const productionExecutable = isModelExecutableDeploymentBinding(job.deployment);
    if (productionExecutable && codexCommandOverride !== null) {
      throw new Error('production worker rejects --codex-command executable overrides');
    }
    if (!productionExecutable && job.deployment?.executionClosure?.immutable === true) {
      throw new Error('immutable qualification job omits an approved executable binding');
    }
    const openedExecutable = productionExecutable
      ? openApprovedModelExecutable(job.deployment.approvedModelExecutable)
      : null;
    const selectedExecutable = productionExecutable
      ? openedExecutable.requestedPath
      : observeExecutableIdentity(codexCommandOverride || 'codex', {
        cwd: temporary,
        env: processEnvironment,
      }).resolvedPath;
    const executedExecutable = productionExecutable
      ? openedExecutable.executedPath
      : selectedExecutable;
    const executableIdentity = productionExecutable
      ? openedExecutable.identity
      : observeExecutableIdentity(selectedExecutable, {
        cwd: temporary,
        env: processEnvironment,
      });
    const startedAt = new Date().toISOString();
    let result;
    try {
      result = await spawnCaptured(executedExecutable, commandArgs, {
        input: prompt,
        maxBuffer: job.limits.maxOutputBytes,
        timeout: (job.limits.timeoutSeconds + 30) * 1000,
        env: processEnvironment,
        cwd: temporary,
        executableDescriptor: openedExecutable?.descriptor ?? null,
      });
    } finally {
      if (openedExecutable !== null) fs.closeSync(openedExecutable.descriptor);
    }
    const completedAt = new Date().toISOString();
    const interval = executionInterval(job, startedAt, completedAt);
    const events = parseEvents(result.stdout);
    const rawEventLedgerBytes = Buffer.from(result.stdout || '', 'utf8');
    const tools = observedToolEvents(events);
    const providerUsage = usage(events);
    const providerRequestId = observedIdentity(events, ['request_id', 'requestId', 'response_id', 'responseId']);
    const providerSessionId = observedIdentity(events, ['session_id', 'sessionId', 'thread_id', 'threadId']);
    const outputBytes = fs.existsSync(lastMessage) ? fs.readFileSync(lastMessage) : Buffer.alloc(0);
    // Codex JSONL guarantees an observed ephemeral thread/session identity but
    // does not guarantee a distinct provider request id. The canonical
    // execution-evidence schema therefore permits a null providerRequestId;
    // keep the observed session id, positive usage, and exact raw ledger as
    // the fail-closed identity/evidence requirements.
    let mechanicallyValid = !result.error && result.status === 0 && tools.length === 0
      && interval.valid
      && positiveUsage(providerUsage) && outputBytes.length > 0
      && outputBytes.length <= job.limits.maxOutputBytes
      && providerSessionId !== null;
    let postprocessError = null;
    durableExclusiveWrite(path.join(artifactRoot, 'raw-events.ndjson'), rawEventLedgerBytes);
    const rawStderrBytes = Buffer.from(result.stderr || '', 'utf8');
    durableExclusiveWrite(path.join(artifactRoot, 'stderr.raw'), rawStderrBytes);
    durableExclusiveWrite(path.join(artifactRoot, 'output.json'), outputBytes);
    if (mechanicallyValid) {
      try {
        materializeProofReplayRequest(job, outputBytes, proofDependencyBinding);
      } catch (error) {
        mechanicallyValid = false;
        postprocessError = error.message;
      }
    }
    let executionEvidenceCore = null;
    let executionEvidenceDigest = null;
    let evidenceError = null;
    if (mechanicallyValid) {
      try {
        const proofTaskId = validateProofCandidateJobTask(job.task).ok
          ? proofCandidateTaskId(job.task)
          : null;
        const taskId = job.task?.signedTask?.taskId
          || job.task?.taskId
          || proofTaskId
          || job.task?.examId
          || null;
        executionEvidenceCore = createExecutionEvidenceCore({
          executionKind: 'model',
          bindings: {
            candidateId: job.task?.signedTask?.subjectId
              || job.task?.release?.subjectId
              || null,
            candidateSessionId: job.sessionId,
            candidateSha256: sha256Text(outputBytes),
            taskId,
            taskSha256: digest(job.task || {
              promptSha256: job.promptSha256,
              outputSchema: job.outputSchema,
            }),
            jobId: job.jobId,
            jobSha256: digest(job),
            campaignId: job.campaignId,
            campaignSha256: job.campaignDigest,
            deploymentSha256: deploymentBindingDigest(job.deployment),
            sourceSha256: executionSourceSha256(job.deployment),
          },
          declaredEnvironment: {
            executionKind: 'host_process',
            role: job.role,
            modelRuntime: job.modelRuntime,
          },
          observedEnvironment: observeProcessEnvironment(processEnvironment),
          requestedArgv: [selectedExecutable, ...commandArgs],
          executedArgv: [executedExecutable, ...commandArgs],
          executable: executableIdentity,
          cwd: temporary,
          startedAt,
          completedAt,
          exitCode: result.status,
          signal: result.signal,
          error: result.error?.message || null,
          input: {
            name: 'prompt',
            mediaType: 'text/plain; charset=utf-8',
            bytes: Buffer.from(prompt, 'utf8'),
          },
          stdout: rawEventLedgerBytes,
          stderr: rawStderrBytes,
          outputFiles: [{
            name: 'model_output',
            path: 'output.json',
            mediaType: 'application/json',
            bytes: outputBytes,
          }],
          model: {
            provider: 'openai-codex',
            model: job.modelRuntime.model,
            thinking: 'xhigh',
            sandbox: 'read-only',
            toolsAllowed: false,
            toolsUsed: [],
            usage: providerUsage,
            providerRequestId,
            providerSessionId,
            plannedSessionId: job.sessionId,
          },
        });
        executionEvidenceDigest = executionEvidenceSha256(executionEvidenceCore);
      } catch (error) {
        mechanicallyValid = false;
        evidenceError = error.message;
      }
    }
    const call = {
      schemaVersion: 'cortex.learning_os.phd_worker_call.v2',
      jobId: job.jobId,
      jobDigest: interval.jobDigest,
      role: job.role,
      command: selectedExecutable,
      args: commandArgs,
      plannedSessionId: job.sessionId,
      providerRequestId,
      providerSessionId,
      provider: 'openai-codex',
      model: job.modelRuntime.model,
      thinking: 'xhigh',
      sandbox: 'read-only',
      toolsAllowed: false,
      toolsUsed: tools.map((event) => event?.item?.type || event?.type || 'unknown'),
      usage: providerUsage,
      positiveUsage: positiveUsage(providerUsage),
      isolatedDirectory: true,
      exactPromptBytes: true,
      promptSha256: job.promptSha256,
      outputSha256: sha256Text(outputBytes),
      rawEventLedgerSha256: sha256Text(rawEventLedgerBytes),
      executionIdentity: binding,
      notBefore: job.notBefore,
      startedAt,
      completedAt,
      expiresAt: job.expiresAt,
      executionIntervalSha256: interval.executionIntervalSha256,
      exitCode: result.status,
      signal: result.signal,
      error: result.error?.message || null,
      postprocessError,
      evidenceError,
      stderrSha256: sha256Text(rawStderrBytes),
      executionEvidenceCore,
      executionEvidenceSha256: executionEvidenceDigest,
      attestation: null,
      provenanceStatus: executionEvidenceCore
        ? 'awaiting_trusted_runner_attestation'
        : 'incomplete_execution_evidence',
    };
    write(path.join(artifactRoot, 'model-call.json'), call);
    const summary = {
      schemaVersion: PHD_WORKER_SUMMARY_SCHEMA,
      jobId: job.jobId,
      campaignId: job.campaignId,
      jobDigest: interval.jobDigest,
      executor,
      status: mechanicallyValid ? 'candidate' : 'failed',
      notBefore: job.notBefore,
      startedAt,
      completedAt,
      expiresAt: job.expiresAt,
      executionIntervalSha256: interval.executionIntervalSha256,
      timingProvenance: 'worker_observed_awaiting_execution_attestation',
      outputSha256: sha256Text(outputBytes),
      executionIdentity: binding,
      authority: 'worker_evidence_only',
      canonicalStateMutated: false,
      ...(mechanicallyValid ? {} : {
        blocker: createPhdWorkerBlocker({
          code: 'mechanically_invalid',
          phase: 'model_execution',
          message: 'model execution did not satisfy the mechanically valid candidate contract',
        }),
      }),
      truthBoundary: mechanicallyValid
        ? 'Candidate artifacts await independent control-plane grading, proof replay, role checks, and atomic application.'
        : 'Worker evidence is incomplete or invalid; no partial apply or qualification claim is allowed.',
    };
    write(path.join(artifactRoot, 'worker-summary.json'), summary);
    writeManifest(job, summary, binding);
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = mechanicallyValid ? 0 : 4;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  }
} catch (error) {
  if (artifactRoot) {
    if (job && !fs.existsSync(path.join(artifactRoot, 'job.json'))) {
      write(path.join(artifactRoot, 'job.json'), job);
    }
    const blocker = createPhdWorkerBlocker({
      code: 'worker_exception',
      phase: 'worker_exception',
      message: error.message,
    });
    const failureOutput = {
      schemaVersion: 'cortex.learning_os.phd_worker_failure.v1',
      blocker,
      executionIdentity: binding || (job ? executionIdentity(job) : null),
      authority: 'worker_evidence_only',
      canonicalStateMutated: false,
    };
    const outputPath = path.join(artifactRoot, 'output.json');
    if (!fs.existsSync(outputPath)) write(outputPath, failureOutput);
    const completedAt = new Date().toISOString();
    const interval = job
      ? executionInterval(job, workerStartedAt, completedAt)
      : {
        jobDigest: null,
        notBefore: null,
        expiresAt: null,
        executionIntervalSha256: null,
        valid: false,
      };
    const summary = {
      schemaVersion: PHD_WORKER_SUMMARY_SCHEMA,
      jobId: job?.jobId || null,
      campaignId: job?.campaignId || null,
      jobDigest: interval.jobDigest,
      executor: job?.executor || null,
      status: 'failed',
      blocker,
      notBefore: interval.notBefore,
      startedAt: workerStartedAt,
      completedAt,
      expiresAt: interval.expiresAt,
      executionIntervalSha256: interval.executionIntervalSha256,
      timingProvenance: interval.valid
        ? 'worker_observed_awaiting_execution_attestation'
        : 'invalid_or_expired_execution_interval',
      outputSha256: sha256File(outputPath),
      executionIdentity: binding || (job ? executionIdentity(job) : null),
      authority: 'worker_evidence_only',
      canonicalStateMutated: false,
      truthBoundary: 'Worker failure cannot partially apply or qualify canonical state.',
    };
    const summaryPath = path.join(artifactRoot, 'worker-summary.json');
    if (!fs.existsSync(summaryPath)) write(summaryPath, summary);
    if (job && !fs.existsSync(path.join(artifactRoot, 'artifact-manifest.json'))) {
      writeManifest(job, summary, binding || executionIdentity(job));
    }
  }
  console.error(error.message);
  process.exitCode = 4;
}
