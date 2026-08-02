import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  buildDeploymentBinding,
  deploymentBindingDigest,
} from '../src/deployment-identity.mjs';
import {
  createExecutionEvidenceCore,
  executionEvidenceSha256,
  executionSourceSha256,
} from '../src/execution-evidence.mjs';
import { buildWorkingTreeExecutionClosure } from '../src/git-product-source.mjs';
import { sha256File, sha256Text } from '../src/hash.mjs';
import { validatePhdWorkerArtifact } from '../src/validate-phd-worker-artifact.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const closRoot = path.dirname(testDirectory);
const EXECUTORS = [
  'model_no_tools',
  'frozen_task_materialization',
  'authority_request_materialization',
  'frozen_research_reproduction',
];
const sourceCommit = 'a'.repeat(40);
const sourceTree = 'b'.repeat(40);
const productTree = 'c'.repeat(40);
const executionClosure = buildWorkingTreeExecutionClosure({
  sourceCommit,
  sourceTree,
  productTree,
});
const deployment = buildDeploymentBinding({
  sourceCommit,
  sourceTree,
  productTree,
  executionClosure,
  artifacts: { graph: 'expiry fixture graph' },
});
const executionIdentity = {
  planDigest: '3'.repeat(64),
  campaignDigest: '4'.repeat(64),
  descriptorSetSha256: '5'.repeat(64),
  productTree,
  runtimeSha256: deployment.runtimeSha256,
  closureSha256: deployment.closureSha256,
};

function digest(value) {
  return sha256Text(canonicalJson(value));
}

function writeJson(target, value) {
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function artifactFixture(root, executor, {
  startedAt = '2026-07-28T10:00:00.000Z',
  completedAt = '2026-07-28T10:05:00.000Z',
  status = 'candidate',
} = {}) {
  fs.mkdirSync(root, { mode: 0o700 });
  const prompt = Buffer.from('fixture exact prompt');
  const sourceBundle = {
    schemaVersion: 'cortex.learning_os.research_source_bundle.v1',
    entrypoint: 'run.mjs',
  };
  const sourceBytes = Buffer.from(canonicalJson(sourceBundle), 'utf8');
  const job = {
    schemaVersion: 'cortex.learning_os.phd_detached_job.v2',
    jobId: `expiry-${executor}`,
    campaignId: 'expiry-campaign',
    campaignDigest: executionIdentity.campaignDigest,
    role: executor === 'model_no_tools' ? 'exam' : 'fixture-inert',
    sessionId: 'fixture-session',
    executor,
    deployment,
    promptBase64: prompt.toString('base64'),
    promptSha256: sha256Text(prompt),
    descriptorSha256: 'e'.repeat(64),
    idempotencyKey: 'f'.repeat(64),
    notBefore: '2026-07-28T09:00:00.000Z',
    expiresAt: '2026-07-28T11:00:00.000Z',
    modelRuntime: executor === 'model_no_tools'
      ? {
        provider: 'openai-codex',
        model: 'fixture-model',
        thinking: 'xhigh',
        sandbox: 'read-only',
        toolsAllowed: false,
      }
      : null,
    task: executor === 'frozen_research_reproduction'
      ? {
        sourceBundle,
        sourceBundleSha256: sha256Text(sourceBytes),
      }
      : {},
    controlPlaneSignature: {
      algorithm: 'hmac-sha256',
      keyId: '1'.repeat(16),
      digest: '2'.repeat(64),
    },
  };
  const jobDigest = digest(job);
  const interval = {
    jobDigest,
    notBefore: job.notBefore,
    startedAt,
    completedAt,
    expiresAt: job.expiresAt,
  };
  const executionIntervalSha256 = digest(interval);
  const output = Buffer.from('{"answers":[]}\n');
  const rawEvents = Buffer.from('{"type":"turn.completed"}\n');
  const outputSha256 = sha256Text(output);
  const evidenceStartedAt = startedAt ?? '2026-07-28T10:00:00.000Z';
  writeJson(path.join(root, 'job.json'), job);
  fs.writeFileSync(path.join(root, 'output.json'), output, { mode: 0o600 });
  const summary = {
    schemaVersion: 'cortex.learning_os.phd_worker_summary.v2',
    jobId: job.jobId,
    campaignId: job.campaignId,
    jobDigest,
    executor,
    status,
    ...(status === 'failed' ? {
      blocker: {
        schemaVersion: 'cortex.learning_os.phd_worker_blocker.v1',
        code: 'worker_exception',
        phase: 'worker_exception',
        message: 'bounded fixture exception',
      },
    } : {}),
    notBefore: job.notBefore,
    startedAt,
    completedAt,
    expiresAt: job.expiresAt,
    executionIntervalSha256,
    timingProvenance: 'worker_observed_awaiting_execution_attestation',
    outputSha256,
    executionIdentity,
    authority: 'worker_evidence_only',
    canonicalStateMutated: false,
    truthBoundary: 'Fixture candidate awaits independent authenticated execution evidence.',
  };
  writeJson(path.join(root, 'worker-summary.json'), summary);
  if (executor === 'model_no_tools') {
    const command = process.execPath;
    const args = [
      'exec',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--model',
      'fixture-model',
      '--config',
      'model_reasoning_effort="xhigh"',
      '--cd',
      root,
      '--json',
      '--output-schema',
      path.join(root, 'fixture.schema.json'),
      '--output-last-message',
      path.join(root, 'output.json'),
      '-',
    ];
    const rawStderr = Buffer.alloc(0);
    const executableStat = fs.statSync(process.execPath);
    const core = createExecutionEvidenceCore({
      executionKind: 'model',
      bindings: {
        candidateId: null,
        candidateSessionId: job.sessionId,
        candidateSha256: outputSha256,
        taskId: null,
        taskSha256: digest(job.task),
        jobId: job.jobId,
        jobSha256: jobDigest,
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
      observedEnvironment: { fixture: true },
      requestedArgv: [command, ...args],
      executedArgv: [command, ...args],
      executable: {
        invoked: command,
        resolvedPath: fs.realpathSync(process.execPath),
        bytes: executableStat.size,
        sha256: sha256File(process.execPath),
      },
      cwd: root,
      startedAt: evidenceStartedAt,
      completedAt,
      exitCode: 0,
      signal: null,
      error: null,
      input: {
        name: 'prompt',
        mediaType: 'text/plain; charset=utf-8',
        bytes: prompt,
      },
      stdout: rawEvents,
      stderr: rawStderr,
      outputFiles: [{
        name: 'model_output',
        path: 'output.json',
        mediaType: 'application/json',
        bytes: output,
      }],
      model: {
        provider: 'openai-codex',
        model: 'fixture-model',
        thinking: 'xhigh',
        sandbox: 'read-only',
        toolsAllowed: false,
        toolsUsed: [],
        usage: { input_tokens: 1, output_tokens: 1 },
        providerRequestId: 'fixture-request',
        providerSessionId: 'fixture-provider-session',
        plannedSessionId: job.sessionId,
      },
    });
    if (startedAt === null) core.process.startedAt = null;
    fs.writeFileSync(path.join(root, 'raw-events.ndjson'), rawEvents, { mode: 0o600 });
    fs.writeFileSync(path.join(root, 'stderr.raw'), rawStderr, { mode: 0o600 });
    writeJson(path.join(root, 'model-call.json'), {
      schemaVersion: 'cortex.learning_os.phd_worker_call.v2',
      jobId: job.jobId,
      jobDigest,
      role: 'exam',
      command,
      args,
      plannedSessionId: 'fixture-session',
      providerRequestId: 'fixture-request',
      providerSessionId: 'fixture-provider-session',
      provider: 'openai-codex',
      model: 'fixture-model',
      thinking: 'xhigh',
      sandbox: 'read-only',
      toolsAllowed: false,
      toolsUsed: [],
      usage: { input_tokens: 1, output_tokens: 1 },
      positiveUsage: true,
      isolatedDirectory: true,
      exactPromptBytes: true,
      promptSha256: job.promptSha256,
      outputSha256,
      rawEventLedgerSha256: sha256Text(rawEvents),
      executionIdentity,
      notBefore: job.notBefore,
      startedAt,
      completedAt,
      expiresAt: job.expiresAt,
      executionIntervalSha256,
      exitCode: 0,
      signal: null,
      error: null,
      postprocessError: null,
      evidenceError: null,
      stderrSha256: sha256Text(''),
      executionEvidenceCore: core,
      executionEvidenceSha256: startedAt === null
        ? digest(core)
        : executionEvidenceSha256(core),
      attestation: null,
      provenanceStatus: 'awaiting_trusted_runner_attestation',
    });
  } else {
    writeJson(path.join(root, 'execution-record.json'), {
      schemaVersion: 'cortex.learning_os.phd_inert_execution.v2',
      jobId: job.jobId,
      jobDigest,
      role: 'fixture-inert',
      executor,
      sessionId: 'fixture-session',
      descriptorSha256: job.descriptorSha256,
      idempotencyKey: job.idempotencyKey,
      executionIdentity,
      dependencyBindings: [],
      outputSha256,
      notBefore: job.notBefore,
      startedAt,
      completedAt,
      expiresAt: job.expiresAt,
      executionIntervalSha256,
      authority: 'worker_evidence_only',
      canonicalStateMutated: false,
    });
    if (executor === 'frozen_research_reproduction') {
      const rawStdout = Buffer.alloc(0);
      const rawStderr = Buffer.alloc(0);
      const executableStat = fs.statSync(process.execPath);
      const core = createExecutionEvidenceCore({
        executionKind: 'process',
        bindings: {
          candidateId: null,
          candidateSessionId: job.sessionId,
          candidateSha256: outputSha256,
          taskId: null,
          taskSha256: digest(job.task),
          jobId: job.jobId,
          jobSha256: jobDigest,
          campaignId: job.campaignId,
          campaignSha256: job.campaignDigest,
          deploymentSha256: deploymentBindingDigest(job.deployment),
          sourceSha256: job.task.sourceBundleSha256,
        },
        declaredEnvironment: { executionKind: 'frozen_research_reproduction' },
        observedEnvironment: { fixture: true },
        requestedArgv: [process.execPath, '--version'],
        executedArgv: [process.execPath, '--version'],
        executable: {
          invoked: process.execPath,
          resolvedPath: fs.realpathSync(process.execPath),
          bytes: executableStat.size,
          sha256: sha256File(process.execPath),
        },
        cwd: root,
        startedAt: evidenceStartedAt,
        completedAt,
        exitCode: 0,
        signal: null,
        error: null,
        input: {
          name: 'research_source_bundle',
          mediaType: 'application/json',
          bytes: sourceBytes,
        },
        stdout: rawStdout,
        stderr: rawStderr,
        outputFiles: [],
        model: null,
      });
      if (startedAt === null) core.process.startedAt = null;
      const evidenceDigest = startedAt === null
        ? digest(core)
        : executionEvidenceSha256(core);
      fs.writeFileSync(path.join(root, 'stdout.raw'), rawStdout, { mode: 0o600 });
      fs.writeFileSync(path.join(root, 'stderr.raw'), rawStderr, { mode: 0o600 });
      writeJson(path.join(root, 'reproduction-authority-request.json'), {
        status: 'ready_for_independent_authority',
        executionEvidenceCore: core,
        executionEvidenceSha256: evidenceDigest,
        requestedAttestationPayload: {
          executionEvidenceCore: core,
          executionEvidenceSha256: evidenceDigest,
        },
      });
    }
  }
  const files = fs.readdirSync(root)
    .filter((name) => name !== 'artifact-manifest.json')
    .sort()
    .map((name) => ({
      path: name,
      bytes: fs.statSync(path.join(root, name)).size,
      ownerUid: 0,
      ownerGid: 0,
      mode: '0444',
      linkCount: 1,
      sha256: sha256File(path.join(root, name)),
    }));
  writeJson(path.join(root, 'artifact-manifest.json'), {
    schemaVersion: 'cortex.learning_os.phd_worker_manifest.v3',
    jobId: job.jobId,
    campaignId: job.campaignId,
    jobDigest,
    jobControlPlaneSignature: job.controlPlaneSignature,
    deployment: job.deployment,
    executor,
    executionIdentity,
    promptSha256: job.promptSha256,
    status: summary.status,
    notBefore: job.notBefore,
    startedAt,
    completedAt,
    expiresAt: job.expiresAt,
    executionIntervalSha256,
    timingProvenance: summary.timingProvenance,
    outputSha256,
    publication: {
      schemaVersion: 'cortex.learning_os.phd_terminal_publication.v1',
      publisherUid: 0,
      publisherGid: 0,
      rootMode: '0555',
      fileMode: '0444',
      directoryMode: '0555',
      regularFileLinkCount: 1,
      rootLinkCount: 2,
      producerWritableTerminal: false,
      noFollow: true,
      exactMetadata: true,
    },
    directories: [],
    files,
    authority: 'worker_evidence_only',
    truthBoundary: 'Fixture manifest is worker evidence only.',
  });
  const jobPath = path.join(root, '..', `${job.jobId}.json`);
  writeJson(jobPath, job);
  return { job, jobPath };
}

function validate(fixture, root) {
  try {
    validatePhdWorkerArtifact({
      jobPath: fixture.jobPath,
      artifactRoot: root,
      expectedExecutionIdentity: executionIdentity,
      checkoutRoot: path.resolve(closRoot, '..'),
    });
    return { status: 0, stdout: 'valid\n', stderr: '' };
  } catch (error) {
    return { status: 1, stdout: '', stderr: `${error.message}\n`, error };
  }
}

test('JS artifact validator accepts one exact in-window interval for every executor', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-worker-valid-'));
  try {
    for (const executor of EXECUTORS) {
      const root = path.join(temporary, executor);
      const fixture = artifactFixture(root, executor);
      const result = validate(fixture, root);
      assert.equal(
        result.status,
        0,
        `${executor}: ${result.stderr || result.stdout || result.error?.message}`,
      );
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('JS publisher validator accepts exact failed terminals and rejects blocker tamper', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-worker-failed-'));
  try {
    for (const executor of EXECUTORS) {
      const root = path.join(temporary, executor);
      const fixture = artifactFixture(root, executor, { status: 'failed' });
      assert.equal(validate(fixture, root).status, 0, executor);
      const summaryPath = path.join(root, 'worker-summary.json');
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      summary.blocker.unapproved = true;
      writeJson(summaryPath, summary);
      const manifestPath = path.join(root, 'artifact-manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const summaryRecord = manifest.files.find((record) => (
        record.path === 'worker-summary.json'
      ));
      summaryRecord.bytes = fs.statSync(summaryPath).size;
      summaryRecord.sha256 = sha256File(summaryPath);
      writeJson(manifestPath, manifest);
      assert.notEqual(validate(fixture, root).status, 0, executor);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('JS artifact validator rejects completion after signed expiry for every executor', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-worker-expired-'));
  try {
    for (const executor of EXECUTORS) {
      const root = path.join(temporary, executor);
      const fixture = artifactFixture(root, executor, {
        completedAt: '2026-07-28T11:00:00.001Z',
      });
      const result = validate(fixture, root);
      assert.notEqual(result.status, 0, executor);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('JS artifact validator rejects missing and cross-file inconsistent timestamps', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-worker-missing-time-'));
  try {
    for (const executor of EXECUTORS) {
      const root = path.join(temporary, executor);
      const fixture = artifactFixture(root, executor, { startedAt: null });
      assert.notEqual(validate(fixture, root).status, 0, executor);
    }
    const root = path.join(temporary, 'inconsistent');
    const fixture = artifactFixture(root, 'model_no_tools');
    const manifest = JSON.parse(fs.readFileSync(
      path.join(root, 'artifact-manifest.json'),
      'utf8',
    ));
    manifest.completedAt = '2026-07-28T10:06:00.000Z';
    writeJson(path.join(root, 'artifact-manifest.json'), manifest);
    const result = validate(fixture, root);
    assert.notEqual(result.status, 0);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('shared terminal contract rejects manifest-consistent semantic mutations before resume or harvest', () => {
  const mutations = [
    ['positiveUsage', false],
    ['isolatedDirectory', false],
    ['exactPromptBytes', false],
    ['provenanceStatus', 'ready'],
    ['plannedSessionId', 'substituted-session'],
  ];
  for (const [field, value] of mutations) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), `clos-worker-${field}-`));
    try {
      const root = path.join(temporary, 'model');
      const fixture = artifactFixture(root, 'model_no_tools');
      const callPath = path.join(root, 'model-call.json');
      const call = JSON.parse(fs.readFileSync(callPath, 'utf8'));
      call[field] = value;
      writeJson(callPath, call);
      const manifestPath = path.join(root, 'artifact-manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const record = manifest.files.find((candidate) => candidate.path === 'model-call.json');
      record.bytes = fs.statSync(callPath).size;
      record.sha256 = sha256File(callPath);
      writeJson(manifestPath, manifest);
      const result = validate(fixture, root);
      assert.notEqual(result.status, 0, field);
      assert.match(result.stderr, /terminal model artifact contract mismatch/);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
});
