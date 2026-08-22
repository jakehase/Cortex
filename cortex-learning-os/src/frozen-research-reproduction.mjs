#!/usr/bin/env node
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  createExecutionEvidenceCore,
  executionEvidenceSha256,
  observeExecutableIdentity,
} from './execution-evidence.mjs';
import {
  approvedResearchRuntimeStdio,
  assertApprovedResearchDaemonAtPath,
  openApprovedResearchRuntime,
  validateApprovedResearchRuntimeBinding,
} from './approved-research-runtime.mjs';
import {
  validateResearchKernelEvidence,
  waitForResearchKernelEvidence,
} from './research-kernel-evidence.mjs';
import { validateJsonSchema } from './json-schema-validation.mjs';

export const RESEARCH_SOURCE_BUNDLE_SCHEMA = 'cortex.learning_os.research_source_bundle.v1';
export const RESEARCH_REPRODUCTION_TASK_SCHEMA = 'cortex.learning_os.research_reproduction_task.v1';
export const RESEARCH_REPRODUCTION_REQUEST_SCHEMA = 'cortex.learning_os.research_reproduction_authority_request.v4';

const DIGEST = /^[0-9a-f]{64}$/;
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_PATH_BYTES = 4096;
const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_BUNDLE_SCHEMA_PATH = path.join(
  MODULE_ROOT,
  '../schemas/research-source-bundle.schema.json',
);
const REPRODUCTION_TASK_SCHEMA_PATH = path.join(
  MODULE_ROOT,
  '../schemas/research-reproduction-task.schema.json',
);
const SOURCE_BUNDLE_KEYS = new Set(['files', 'schemaVersion']);
const SOURCE_FILE_KEYS = new Set(['bytesBase64', 'executable', 'path', 'sha256']);
const CANDIDATE_BINDING_KEYS = new Set([
  'artifact',
  'artifactDigest',
  'candidateSessionId',
  'harvestedAuthority',
  'jobId',
  'outputSha256',
  'result',
  'resultDigest',
]);
const EXECUTION_BINDING_KEYS = new Set([
  'campaignId',
  'campaignSha256',
  'deploymentSha256',
  'jobId',
  'jobSha256',
]);

function digestBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function digest(value) {
  return digestBytes(Buffer.from(canonicalJson(value), 'utf8'));
}

function exactKeys(value, expected) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === expected.size
    && Object.keys(value).every((key) => expected.has(key));
}

function safeRelative(value, label) {
  const segments = typeof value === 'string' ? value.split('/') : [];
  if (typeof value !== 'string'
      || Buffer.byteLength(value, 'utf8') < 1
      || Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES
      || !SAFE_PATH.test(value)
      || path.posix.isAbsolute(value)
      || path.posix.normalize(value) !== value
      || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`unsafe ${label} path`);
  }
  return value;
}

function strictBase64(value, label) {
  if (typeof value !== 'string' || value.length < 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error(`${label} is not canonical base64`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 1 || bytes.toString('base64') !== value) {
    throw new Error(`${label} is not canonical base64`);
  }
  return bytes;
}

export function validateResearchSourceBundle(bundle) {
  const schemaValidation = validateJsonSchema(bundle, SOURCE_BUNDLE_SCHEMA_PATH);
  const errors = schemaValidation.errors.map(
    (error) => `research source bundle schema: ${error}`,
  );
  const seen = new Set();
  let totalBytes = 0;
  if (!exactKeys(bundle, SOURCE_BUNDLE_KEYS)
      || bundle?.schemaVersion !== RESEARCH_SOURCE_BUNDLE_SCHEMA
      || !Array.isArray(bundle.files) || bundle.files.length < 1 || bundle.files.length > 256) {
    return {
      ok: false,
      errors: ['research source bundle header or file set is invalid', ...errors],
    };
  }
  for (const file of bundle.files) {
    let bytes = Buffer.alloc(0);
    try {
      safeRelative(file?.path, 'research source');
      bytes = strictBase64(file?.bytesBase64, `research source ${String(file?.path || '')}`);
    } catch (error) {
      errors.push(error.message);
      continue;
    }
    totalBytes += bytes.length;
    if (!exactKeys(file, SOURCE_FILE_KEYS)
        || seen.has(file.path)
        || typeof file.executable !== 'boolean'
        || !DIGEST.test(String(file.sha256 || ''))
        || digestBytes(bytes) !== file.sha256) {
      errors.push(`research source file binding is invalid: ${file.path}`);
    }
    seen.add(file.path);
  }
  if (totalBytes > MAX_SOURCE_BYTES) errors.push('research source bundle exceeds the frozen size bound');
  return { ok: errors.length === 0, errors, totalBytes };
}

export function researchSourceBundleDigest(bundle) {
  const validation = validateResearchSourceBundle(bundle);
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  return digest(bundle);
}

function validateEnvironment(environment, fixtureOnly) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)
      || environment.immutable !== true || environment.networkDisabled !== true
      || !DIGEST.test(String(environment.lockDigest || ''))) {
    throw new Error('frozen research environment identity is incomplete');
  }
  if (fixtureOnly) {
    if (environment.executionKind !== 'host_fixture') {
      throw new Error('fixture reproduction requires the explicit host_fixture execution kind');
    }
    return;
  }
  if (environment.executionKind !== 'container'
      || environment.containerRuntime !== 'docker'
      || !/^sha256:[0-9a-f]{64}$/.test(String(environment.imageDigest || ''))
      || !/^sha256:[0-9a-f]{64}$/.test(String(environment.imageId || ''))
      || typeof environment.imageReference !== 'string'
      || !environment.imageReference.endsWith(`@${environment.imageDigest}`)) {
    throw new Error('production reproduction requires an immutable digest-addressed container');
  }
}

export function validateResearchReproductionTask(task) {
  const schemaValidation = validateJsonSchema(task, REPRODUCTION_TASK_SCHEMA_PATH);
  const errors = schemaValidation.errors.map(
    (error) => `research reproduction task schema: ${error}`,
  );
  try {
    if (task?.schemaVersion !== RESEARCH_REPRODUCTION_TASK_SCHEMA
        || typeof task.campaignId !== 'string'
        || typeof task.candidateJobId !== 'string'
        || typeof task.candidateSessionId !== 'string'
        || !DIGEST.test(String(task.candidatePromptSha256 || ''))
        || typeof task.sourceBundleSha256 !== 'string'
        || researchSourceBundleDigest(task.sourceBundle) !== task.sourceBundleSha256
        || digest(task.environment) !== task.environmentDigest
        || digest(task.command) !== task.commandDigest
        || !Array.isArray(task.command) || task.command.length < 1
        || task.command.length > 512
        || task.command.some((part) => typeof part !== 'string' || part.length < 1 || part.length > 4096)
        || !Array.isArray(task.outputPaths) || task.outputPaths.length < 1
        || task.outputPaths.length > 128
        || new Set(task.outputPaths).size !== task.outputPaths.length
        || !Number.isSafeInteger(task.timeoutSeconds)
        || task.timeoutSeconds < 30 || task.timeoutSeconds > 3600
        || !task.outputPaths.includes(task.resultPath)) {
      errors.push('research reproduction task identity or command is invalid');
    }
    if (task?.fixtureOnly === true) {
      if (task.approvedResearchRuntime !== null
          || task.approvedResearchRuntimeSha256 !== null) {
        errors.push('fixture reproduction cannot claim an approved research runtime');
      }
    } else {
      const runtime = validateApprovedResearchRuntimeBinding(
        task?.approvedResearchRuntime,
        { observe: false },
      );
      if (!runtime.ok
          || task.approvedResearchRuntimeSha256 !== digest(task.approvedResearchRuntime)
          || task.approvedResearchRuntime?.kind !== task.environment?.containerRuntime) {
        errors.push(
          'production reproduction approved runtime, daemon closure, or digest is invalid',
          ...runtime.errors,
        );
      }
    }
    for (const outputPath of task?.outputPaths || []) safeRelative(outputPath, 'research output');
    safeRelative(task?.resultPath, 'research result');
    validateEnvironment(task?.environment, task?.fixtureOnly === true);
  } catch (error) {
    errors.push(error.message);
  }
  return { ok: errors.length === 0, errors };
}

function writeExactSource(bundle, targetRoot) {
  for (const file of bundle.files) {
    const target = path.join(targetRoot, ...file.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const bytes = Buffer.from(file.bytesBase64, 'base64');
    fs.writeFileSync(target, bytes, {
      flag: 'wx',
      mode: file.executable ? 0o700 : 0o600,
    });
  }
}

function outputRecords(workspace, outputPaths, retainedRoot) {
  let totalBytes = 0;
  return outputPaths.map((relative) => {
    const source = path.join(workspace, ...relative.split('/'));
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`reproduction output is missing or unsafe: ${relative}`);
    }
    const bytes = fs.readFileSync(source);
    if (bytes.length !== stat.size) throw new Error(`reproduction output changed while retained: ${relative}`);
    totalBytes += bytes.length;
    if (totalBytes > MAX_OUTPUT_BYTES) throw new Error('reproduction outputs exceed the retained size bound');
    const target = path.join(retainedRoot, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
    fs.chmodSync(target, 0o600);
    return {
      path: relative,
      bytes: bytes.length,
      sha256: digestBytes(bytes),
    };
  });
}

function runProcess(command, args, {
  cwd = undefined,
  timeout,
  maxBuffer,
  env,
  executableDescriptor = null,
  liveObserver = null,
} = {}, spawnProcess = spawn) {
  return new Promise((resolve) => {
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let processError = null;
    let settled = false;
    let timer = null;
    let observerResult = null;
    let observerError = null;
    const startedAt = new Date().toISOString();
    const child = spawnProcess(command, args, {
      cwd,
      stdio: executableDescriptor === null
        ? ['ignore', 'pipe', 'pipe']
        : approvedResearchRuntimeStdio(executableDescriptor),
      env,
    });
    const observerPromise = liveObserver === null
      ? Promise.resolve(null)
      : Promise.resolve().then(() => liveObserver(child)).then((result) => {
        observerResult = result;
        return result;
      }, (error) => {
        observerError = error;
        processError = processError || error;
        child.kill('SIGKILL');
        return null;
      });
    const finish = async (status, signal) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      await observerPromise;
      resolve({
        status,
        signal,
        error: processError,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        startedAt,
        completedAt: new Date().toISOString(),
        observerResult,
        observerError,
      });
    };
    const retain = (chunks, chunk, stream) => {
      const bytes = Buffer.from(chunk);
      if (stream === 'stdout') stdoutBytes += bytes.length;
      else stderrBytes += bytes.length;
      if (stdoutBytes > maxBuffer || stderrBytes > maxBuffer) {
        processError = new Error(`reproduction ${stream} exceeded maxBuffer`);
        child.kill('SIGKILL');
        return;
      }
      chunks.push(bytes);
    };
    child.stdout.on('data', (chunk) => retain(stdout, chunk, 'stdout'));
    child.stderr.on('data', (chunk) => retain(stderr, chunk, 'stderr'));
    child.on('error', (error) => {
      processError = error;
      finish(null, null);
    });
    child.on('close', finish);
    timer = setTimeout(() => {
      processError = new Error('research reproduction command timed out');
      child.kill('SIGKILL');
    }, timeout);
    if (settled) clearTimeout(timer);
  });
}

export function validateEffectiveResearchIsolation(inspected, {
  containerId,
  workspace,
  imageId,
  runtimeName,
  seccompProfilePath,
}) {
  const host = inspected?.HostConfig;
  const config = inspected?.Config;
  const mounts = inspected?.Mounts;
  const securityOpt = Array.isArray(host?.SecurityOpt)
    ? [...host.SecurityOpt].sort()
    : [];
  const capDrop = Array.isArray(host?.CapDrop) ? [...host.CapDrop].sort() : [];
  const capAdd = Array.isArray(host?.CapAdd) ? [...host.CapAdd].sort() : [];
  const devices = Array.isArray(host?.Devices) ? host.Devices : [];
  const bind = Array.isArray(mounts)
    ? mounts.filter((entry) => (
      entry?.Type === 'bind'
      && entry.Source === workspace
      && entry.Destination === '/workspace'
    ))
    : [];
  const tmpfs = host?.Tmpfs?.['/tmp'];
  if (!inspected || typeof inspected !== 'object' || Array.isArray(inspected)
      || inspected.Id !== containerId
      || inspected.Image !== imageId
      || host?.NetworkMode !== 'none'
      || host?.ReadonlyRootfs !== true
      || host?.Privileged !== false
      || host?.PidsLimit !== 256
      || host?.Runtime !== runtimeName
      || !host?.LogConfig
      || canonicalJson(host.LogConfig) !== canonicalJson({ Type: 'none', Config: {} })
      || canonicalJson(capDrop) !== canonicalJson(['ALL'])
      || capAdd.length !== 0
      || devices.length !== 0
      || canonicalJson(securityOpt) !== canonicalJson([
        'apparmor=docker-default',
        'no-new-privileges',
        `seccomp=${seccompProfilePath}`,
      ].sort())
      || tmpfs !== 'rw,noexec,nosuid,nodev,size=64m'
      || bind.length !== 1
      || bind[0].RW !== true
      || config?.WorkingDir !== '/workspace') {
    throw new Error('effective research container isolation state is incomplete or mismatched');
  }
  return {
    containerId,
    imageId,
    network: host.NetworkMode,
    rootFilesystem: 'read_only',
    noNewPrivileges: true,
    privileged: false,
    capabilities: 'none',
    addedCapabilities: 'none',
    devices: 'none',
    pidLimit: host.PidsLimit,
    temporaryFilesystem: 'rw_noexec_nosuid_nodev_64m',
    workspaceMount: {
      type: bind[0].Type,
      source: bind[0].Source,
      destination: bind[0].Destination,
      readWrite: bind[0].RW,
    },
    workingDirectory: config.WorkingDir,
  };
}

function daemonMeasurement(phase, daemonClosure) {
  return {
    phase,
    closureSha256: daemonClosure.closureSha256,
    serviceUnit: daemonClosure.serviceUnit,
    socketPath: daemonClosure.socketPath,
    mainPid: daemonClosure.serviceManager.mainPid,
    invocationId: daemonClosure.serviceManager.invocationId,
    cgroup: daemonClosure.process.cgroup,
    startTimeTicks: daemonClosure.process.startTimeTicks,
    socketDevice: daemonClosure.process.socketDevice,
    socketInode: daemonClosure.process.socketInode,
  };
}

async function executeCommand(task, workspace, spawnProcess = spawn) {
  if (task.fixtureOnly === true) {
    const processEnvironment = {
      LANG: 'C',
      LC_ALL: 'C',
      PATH: process.env.PATH,
    };
    return {
      observedEnvironment: {
        executionKind: 'host_fixture',
        lockDigest: task.environment.lockDigest,
        platform: `${process.platform}-${process.arch}`,
        node: process.version,
      },
      requestedCommand: task.command,
      command: task.command,
      executable: observeExecutableIdentity(task.command[0], {
        cwd: workspace,
        env: processEnvironment,
      }),
      cwd: workspace,
      result: await runProcess(task.command[0], task.command.slice(1), {
        cwd: workspace,
        maxBuffer: 8 * 1024 * 1024,
        timeout: task.timeoutSeconds * 1000,
        env: processEnvironment,
      }, spawnProcess),
    };
  }
  const openedRuntime = openApprovedResearchRuntime(task.approvedResearchRuntime);
  const processEnvironment = {
    LANG: 'C',
    LC_ALL: 'C',
  };
  try {
    const daemonObservation = structuredClone(openedRuntime.daemonObservation);
    const daemonMeasurements = [
      daemonMeasurement('before_image_inspect', daemonObservation),
    ];
    const inspect = await runProcess(openedRuntime.executedPath, [
      ...openedRuntime.endpointArguments,
      'image', 'inspect', '--format', '{{json .}}', task.environment.imageReference,
    ], {
      maxBuffer: 2 * 1024 * 1024,
      timeout: 30_000,
      env: processEnvironment,
      executableDescriptor: openedRuntime.descriptor,
    }, spawnProcess);
    let inspected = null;
    try {
      inspected = JSON.parse(inspect.stdout.toString('utf8'));
      if (Array.isArray(inspected) && inspected.length === 1) [inspected] = inspected;
    } catch {
      inspected = null;
    }
    if (inspect.error || inspect.status !== 0
        || !inspected || typeof inspected !== 'object' || Array.isArray(inspected)
        || inspected.Id !== task.environment.imageId
        || !Array.isArray(inspected.RepoDigests)
        || canonicalJson([...inspected.RepoDigests].sort())
          !== canonicalJson([task.environment.imageReference])) {
      throw new Error('frozen digest-addressed container image identity could not be observed exactly');
    }
    daemonMeasurements.push(daemonMeasurement(
      'after_image_inspect',
      assertApprovedResearchDaemonAtPath(task.approvedResearchRuntime),
    ));
    const imageInspectBytes = Buffer.from(inspect.stdout);
    const containerIdPath = path.join(path.dirname(workspace), 'container.cid');
    const requestedCommand = [
      openedRuntime.requestedPath,
      ...openedRuntime.endpointArguments,
      'run',
      '--cidfile', containerIdPath,
      '--runtime', task.approvedResearchRuntime.daemonClosure.derivedTopology.defaultRuntimeName,
      '--network=none',
      '--read-only',
      '--security-opt=no-new-privileges',
      '--security-opt=apparmor=docker-default',
      `--security-opt=seccomp=${
        task.approvedResearchRuntime.daemonClosure.derivedTopology.seccompProfilePath
      }`,
      '--log-driver=none',
      '--cap-drop=ALL',
      '--pids-limit=256',
      '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m',
      '--volume', `${workspace}:/workspace:rw`,
      '--workdir', '/workspace',
      task.environment.imageReference,
      ...task.command,
    ];
    const command = [openedRuntime.executedPath, ...requestedCommand.slice(1)];
    const isolation = {
      network: 'none',
      rootFilesystem: 'read_only',
      noNewPrivileges: true,
      capabilities: 'none',
      pidLimit: 256,
      temporaryFilesystem: 'rw_noexec_nosuid_nodev_64m',
      workspaceMount: 'rw',
    };
    daemonMeasurements.push(daemonMeasurement(
      'before_run',
      assertApprovedResearchDaemonAtPath(task.approvedResearchRuntime),
    ));
    const runResult = await runProcess(command[0], command.slice(1), {
      maxBuffer: 8 * 1024 * 1024,
      timeout: task.timeoutSeconds * 1000,
      env: processEnvironment,
      executableDescriptor: openedRuntime.descriptor,
      liveObserver: () => waitForResearchKernelEvidence({
        containerIdPath,
        workspace,
        timeoutMs: Math.min(30_000, task.timeoutSeconds * 1000),
      }),
    }, spawnProcess);
    daemonMeasurements.push(daemonMeasurement(
      'after_run',
      assertApprovedResearchDaemonAtPath(task.approvedResearchRuntime),
    ));
    const cidStat = fs.lstatSync(containerIdPath);
    const containerId = fs.readFileSync(containerIdPath, 'utf8').trim();
    if (!cidStat.isFile() || cidStat.isSymbolicLink()
        || cidStat.uid !== process.getuid()
        || (cidStat.mode & 0o022) !== 0
        || !/^[0-9a-f]{64}$/.test(containerId)) {
      throw new Error('research container id evidence is missing or unsafe');
    }
    const containerInspectRequested = [
      openedRuntime.requestedPath,
      ...openedRuntime.endpointArguments,
      'container',
      'inspect',
      '--format',
      '{{json .}}',
      containerId,
    ];
    const containerInspectCommand = [
      openedRuntime.executedPath,
      ...containerInspectRequested.slice(1),
    ];
    const containerInspect = await runProcess(
      containerInspectCommand[0],
      containerInspectCommand.slice(1),
      {
        maxBuffer: 2 * 1024 * 1024,
        timeout: 30_000,
        env: processEnvironment,
        executableDescriptor: openedRuntime.descriptor,
      },
      spawnProcess,
    );
    let inspectedContainer = null;
    try {
      inspectedContainer = JSON.parse(containerInspect.stdout.toString('utf8'));
      if (Array.isArray(inspectedContainer) && inspectedContainer.length === 1) {
        [inspectedContainer] = inspectedContainer;
      }
    } catch {
      inspectedContainer = null;
    }
    let effectiveIsolation = null;
    let containerInspectionError = null;
    const kernelEvidence = runResult.observerResult;
    try {
      if (containerInspect.error || containerInspect.status !== 0) {
        throw new Error('effective research container configuration could not be inspected');
      }
      effectiveIsolation = validateEffectiveResearchIsolation(inspectedContainer, {
        containerId,
        workspace,
        imageId: task.environment.imageId,
        runtimeName: task.approvedResearchRuntime.daemonClosure
          .derivedTopology.defaultRuntimeName,
        seccompProfilePath: task.approvedResearchRuntime.daemonClosure
          .derivedTopology.seccompProfilePath,
      });
      const kernelValidation = validateResearchKernelEvidence(kernelEvidence, {
        containerId,
        workspace,
        expectedCommand: task.command[0],
        expectedLsmProfile: 'docker-default',
        expectedLsmPolicy: task.approvedResearchRuntime.daemonClosure.securityProfiles.find(
          (profile) => profile.kind === 'apparmor',
        ),
        expectedShimSha256: task.approvedResearchRuntime.daemonClosure.runtimeHelpers.find(
          (helper) => helper.path
            === task.approvedResearchRuntime.daemonClosure.derivedTopology.shimPath,
        )?.sha256,
      });
      if (!kernelValidation.ok) {
        throw new Error(
          `independent kernel container evidence rejected execution: ${
            kernelValidation.errors.join('; ')
          }`,
        );
      }
    } catch (error) {
      containerInspectionError = error;
    }
    const removeRequested = [
      openedRuntime.requestedPath,
      ...openedRuntime.endpointArguments,
      'rm',
      '--force',
      containerId,
    ];
    const removeCommand = [openedRuntime.executedPath, ...removeRequested.slice(1)];
    const removed = await runProcess(removeCommand[0], removeCommand.slice(1), {
      maxBuffer: 2 * 1024 * 1024,
      timeout: 30_000,
      env: processEnvironment,
      executableDescriptor: openedRuntime.descriptor,
    }, spawnProcess);
    if (removed.error || removed.status !== 0) {
      throw new Error('research container cleanup failed closed');
    }
    fs.unlinkSync(containerIdPath);
    daemonMeasurements.push(daemonMeasurement(
      'after_cleanup',
      assertApprovedResearchDaemonAtPath(task.approvedResearchRuntime),
    ));
    if (containerInspectionError !== null) throw containerInspectionError;
    const containerInspectBytes = Buffer.from(containerInspect.stdout);
    return {
      observedEnvironment: {
        executionKind: 'container',
        containerRuntime: task.approvedResearchRuntime.kind,
        approvedResearchRuntimeSha256: task.approvedResearchRuntimeSha256,
        runtimeClosureSha256: task.approvedResearchRuntime.runtimeClosureSha256,
        daemonClosureSha256: task.approvedResearchRuntime.daemonClosureSha256,
        daemonObservation,
        daemonSocketPath: task.approvedResearchRuntime.daemonClosure.socketPath,
        daemonMeasurements,
        imageReference: task.environment.imageReference,
        imageDigest: task.environment.imageDigest,
        imageId: inspected.Id,
        imageRepoDigests: [...inspected.RepoDigests].sort(),
        imageInspectBase64: imageInspectBytes.toString('base64'),
        imageInspectSha256: digestBytes(imageInspectBytes),
        containerInspectBase64: containerInspectBytes.toString('base64'),
        containerInspectSha256: digestBytes(containerInspectBytes),
        kernelEvidence,
        effectiveIsolation,
        runtimeCommands: {
          imageInspect: [
            openedRuntime.requestedPath,
            ...openedRuntime.endpointArguments,
            'image', 'inspect', '--format', '{{json .}}',
            task.environment.imageReference,
          ],
          run: requestedCommand,
          containerInspect: containerInspectRequested,
          remove: removeRequested,
        },
        runtimeLockDigest: task.environment.lockDigest,
        processEnvironment,
        isolation,
      },
      requestedCommand,
      command,
      executable: openedRuntime.identity,
      cwd: workspace,
      result: {
        ...runResult,
        startedAt: inspect.startedAt,
        completedAt: removed.completedAt,
      },
    };
  } finally {
    fs.closeSync(openedRuntime.descriptor);
  }
}

export function serializeResearchReproductionAuthorityRequest(request) {
  return Buffer.from(canonicalJson(request), 'utf8');
}

export async function executeFrozenResearchReproduction({
  task,
  artifactRoot,
  candidateBinding,
  executionBinding,
  spawnProcess = spawn,
} = {}) {
  const validation = validateResearchReproductionTask(task);
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  let candidateContentBound = false;
  try {
    candidateContentBound = candidateBinding?.artifact !== null
      && typeof candidateBinding?.artifact === 'object'
      && !Array.isArray(candidateBinding.artifact)
      && digest(candidateBinding.artifact) === candidateBinding.artifactDigest
      && digest(candidateBinding.result) === candidateBinding.resultDigest;
  } catch {
    candidateContentBound = false;
  }
  if (!exactKeys(candidateBinding, CANDIDATE_BINDING_KEYS)
      || candidateBinding.jobId !== task.candidateJobId
      || candidateBinding.candidateSessionId !== task.candidateSessionId
      || !DIGEST.test(String(candidateBinding.artifactDigest || ''))
      || !DIGEST.test(String(candidateBinding.resultDigest || ''))
      || !DIGEST.test(String(candidateBinding.outputSha256 || ''))
      || candidateBinding.harvestedAuthority !== 'worker_evidence_only'
      || !candidateContentBound) {
    throw new Error('research candidate dependency binding is incomplete');
  }
  if (!exactKeys(executionBinding, EXECUTION_BINDING_KEYS)
      || executionBinding.campaignId !== task.campaignId
      || typeof executionBinding.jobId !== 'string'
      || ![
        executionBinding.jobSha256,
        executionBinding.campaignSha256,
        executionBinding.deploymentSha256,
      ].every((value) => DIGEST.test(String(value || '')))) {
    throw new Error('research reproduction job, campaign, or deployment binding is incomplete');
  }
  const exactSourceRoot = path.join(artifactRoot, 'source-exact');
  const retainedOutputRoot = path.join(artifactRoot, 'outputs');
  fs.mkdirSync(exactSourceRoot, { recursive: false, mode: 0o700 });
  fs.mkdirSync(retainedOutputRoot, { recursive: false, mode: 0o700 });
  writeExactSource(task.sourceBundle, exactSourceRoot);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-research-reproduction-'));
  const workspace = path.join(temporary, 'workspace');
  const stdoutPath = path.join(artifactRoot, 'stdout.raw');
  const stderrPath = path.join(artifactRoot, 'stderr.raw');
  try {
    fs.cpSync(exactSourceRoot, workspace, { recursive: true, errorOnExist: true });
    const execution = await executeCommand(task, workspace, spawnProcess);
    const startedAt = execution.result.startedAt;
    const completedAt = execution.result.completedAt;
    const stdout = Buffer.from(execution.result.stdout || '');
    const stderr = Buffer.from(execution.result.stderr || '');
    fs.writeFileSync(stdoutPath, stdout, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(stderrPath, stderr, { flag: 'wx', mode: 0o600 });
    let outputs = [];
    let parsedResult = null;
    let outputError = null;
    try {
      outputs = outputRecords(workspace, task.outputPaths, retainedOutputRoot);
      parsedResult = JSON.parse(
        fs.readFileSync(path.join(retainedOutputRoot, ...task.resultPath.split('/')), 'utf8'),
      );
    } catch (error) {
      outputError = error.message;
    }
    const resultDigest = parsedResult === null ? null : digest(parsedResult);
    const matched = !execution.result.error && execution.result.status === 0
      && outputError === null && resultDigest === candidateBinding.resultDigest;
    const processRecord = {
      exitCode: execution.result.status,
      signal: execution.result.signal,
      error: execution.result.error?.message || null,
    };
    const stdoutSha256 = digestBytes(stdout);
    const stderrSha256 = digestBytes(stderr);
    const authorityOutputs = outputs.map((record) => ({
      path: record.path,
      bytes: record.bytes,
      contentBase64: fs.readFileSync(
        path.join(retainedOutputRoot, ...record.path.split('/')),
      ).toString('base64'),
      sha256: record.sha256,
    }));
    let executionEvidenceCore = null;
    let canonicalExecutionEvidenceSha256 = null;
    try {
      executionEvidenceCore = createExecutionEvidenceCore({
        executionKind: 'process',
        bindings: {
          candidateId: null,
          candidateSessionId: candidateBinding.candidateSessionId,
          candidateSha256: candidateBinding.outputSha256,
          taskId: null,
          taskSha256: digest(task),
          jobId: executionBinding.jobId,
          jobSha256: executionBinding.jobSha256,
          campaignId: executionBinding.campaignId,
          campaignSha256: executionBinding.campaignSha256,
          deploymentSha256: executionBinding.deploymentSha256,
          sourceSha256: task.sourceBundleSha256,
        },
        declaredEnvironment: task.environment,
        observedEnvironment: execution.observedEnvironment,
        requestedArgv: execution.requestedCommand,
        executedArgv: execution.command,
        executable: execution.executable,
        cwd: execution.cwd,
        startedAt,
        completedAt,
        exitCode: processRecord.exitCode,
        signal: processRecord.signal,
        error: processRecord.error,
        input: {
          name: 'source_bundle',
          mediaType: 'application/json',
          bytes: Buffer.from(canonicalJson(task.sourceBundle), 'utf8'),
        },
        stdout,
        stderr,
        outputFiles: outputs.map((record, index) => ({
          name: `output_${index + 1}`,
          path: record.path,
          mediaType: 'application/octet-stream',
          bytes: fs.readFileSync(
            path.join(retainedOutputRoot, ...record.path.split('/')),
          ),
        })),
      });
      canonicalExecutionEvidenceSha256 = executionEvidenceSha256(executionEvidenceCore);
    } catch (error) {
      outputError = outputError || error.message;
    }
    const ready = matched
      && executionEvidenceCore !== null
      && canonicalExecutionEvidenceSha256 !== null;
    const requestedPayload = {
      schemaVersion: 'cortex.learning_os.research_reproduction_bundle.v5',
      fixtureOnly: task.fixtureOnly,
      campaignId: task.campaignId,
      artifactDigest: candidateBinding.artifactDigest,
      sourceBundleSha256: task.sourceBundleSha256,
      environmentDigest: task.environmentDigest,
      commandDigest: task.commandDigest,
      approvedResearchRuntimeSha256: task.approvedResearchRuntimeSha256,
      daemonClosureSha256: task.approvedResearchRuntime?.daemonClosureSha256 || null,
      observedEnvironmentSha256: digest(execution.observedEnvironment),
      executedArgvSha256: digest(execution.command),
      executableSha256: execution.executable.sha256,
      isolationSha256: digest(execution.observedEnvironment.isolation || {}),
      stdoutSha256,
      stderrSha256,
      outputsDigest: digest(authorityOutputs),
      resultOutputPath: task.resultPath,
      resultSha256: authorityOutputs.find((output) => output.path === task.resultPath)?.sha256
        || null,
      resultDigest: candidateBinding.resultDigest,
      status: ready ? 'passed' : 'failed',
      exitCode: processRecord.exitCode,
      startedAt,
      completedAt,
      executionEvidenceCore,
      executionEvidenceSha256: canonicalExecutionEvidenceSha256,
    };
    const requestedPayloadBytes = Buffer.from(canonicalJson(requestedPayload), 'utf8');
    const request = {
      schemaVersion: RESEARCH_REPRODUCTION_REQUEST_SCHEMA,
      requestedCapability: 'research_reproduction',
      unsigned: true,
      selfAttestation: false,
      status: ready ? 'ready_for_independent_authority' : 'reproduction_failed',
      candidateBinding,
      approvedResearchRuntime: task.approvedResearchRuntime,
      approvedResearchRuntimeSha256: task.approvedResearchRuntimeSha256,
      declaredEnvironment: task.environment,
      observedEnvironment: execution.observedEnvironment,
      sourceBundleSha256: task.sourceBundleSha256,
      command: task.command,
      executedCommand: execution.command,
      commandDigest: task.commandDigest,
      startedAt,
      completedAt,
      process: processRecord,
      logs: {
        stdout: 'stdout.raw',
        stdoutSha256: requestedPayload.stdoutSha256,
        stderr: 'stderr.raw',
        stderrSha256: requestedPayload.stderrSha256,
      },
      outputs: authorityOutputs,
      resultPath: task.resultPath,
      result: parsedResult,
      recomputedResultDigest: resultDigest,
      expectedResultDigest: candidateBinding.resultDigest,
      outputError,
      executionEvidenceCore,
      executionEvidenceSha256: canonicalExecutionEvidenceSha256,
      requestedAttestationPayload: requestedPayload,
      requestedAttestationPayloadBytesBase64: requestedPayloadBytes.toString('base64'),
      requestedAttestationPayloadSha256: digestBytes(requestedPayloadBytes),
      authorityAttestation: null,
      truthBoundary: 'This is inert execution evidence and an unsigned request. Only a separate trusted reproduction authority may attest it.',
    };
    return { request, matched: ready };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function readJson(target) {
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('runner input must be a regular file');
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : null;
  };
  try {
    const task = readJson(path.resolve(value('--task')));
    const candidateBinding = readJson(path.resolve(value('--candidate-binding')));
    const executionBinding = readJson(path.resolve(value('--execution-binding')));
    const artifactRoot = path.resolve(value('--artifact-root'));
    fs.mkdirSync(artifactRoot, { recursive: false, mode: 0o700 });
    const result = await executeFrozenResearchReproduction({
      task,
      candidateBinding,
      executionBinding,
      artifactRoot,
    });
    fs.writeFileSync(
      path.join(artifactRoot, 'reproduction-authority-request.json'),
      serializeResearchReproductionAuthorityRequest(result.request),
      { flag: 'wx', mode: 0o600 },
    );
    process.stdout.write(`${JSON.stringify({ ok: result.matched, artifactRoot })}\n`);
    process.exitCode = result.matched ? 0 : 4;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 4;
  }
}
