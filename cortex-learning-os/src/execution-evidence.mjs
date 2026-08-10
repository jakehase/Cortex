import fs from 'node:fs';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { sha256Bytes, sha256File, sha256Text } from './hash.mjs';

export const EXECUTION_EVIDENCE_CORE_SCHEMA = 'cortex.learning_os.execution_evidence_core.v1';

const DIGEST = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const RECORD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9._/-]+$/;
const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
const MAX_EXECUTABLE_BYTES = 1024 * 1024 * 1024;

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

function validTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validOptionalIdentifier(value) {
  return value === null || IDENTIFIER.test(String(value || ''));
}

function validByteRecord(record, keys) {
  return exactKeys(record, keys)
    && RECORD_NAME.test(String(record.name || ''))
    && typeof record.mediaType === 'string'
    && record.mediaType.length > 0
    && record.mediaType.length <= 256
    && Number.isSafeInteger(record.bytes)
    && record.bytes >= 0
    && record.bytes <= MAX_EVIDENCE_BYTES
    && DIGEST.test(String(record.sha256 || ''));
}

function validSafeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 4096
    && SAFE_RELATIVE_PATH.test(value)
    && !path.posix.isAbsolute(value)
    && !value.split('/').includes('..');
}

function validUsage(usage) {
  return isRecord(usage)
    && Object.keys(usage).length > 0
    && Object.entries(usage).every(([key, value]) => (
      RECORD_NAME.test(key)
      && (typeof value === 'string'
        || typeof value === 'boolean'
        || (typeof value === 'number' && Number.isFinite(value)))
    ))
    && Object.entries(usage).some(([key, value]) => (
      /(?:input|output|total|token)/i.test(key) && Number(value) > 0
    ));
}

function canonicalModelCommandErrors(command, model) {
  const errors = [];
  const requested = command?.requestedArgv;
  const executed = command?.executedArgv;
  if (!Array.isArray(requested) || !Array.isArray(executed)
      || requested.length !== executed.length
      || canonicalJson(requested.slice(1)) !== canonicalJson(executed.slice(1))) {
    return ['model execution requestedArgv and executedArgv do not bind one exact argument vector'];
  }
  const expected = [
    executed[0],
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--model',
    model?.model,
    '--config',
    `model_reasoning_effort="${model?.thinking}"`,
    '--cd',
    command?.cwd,
    '--json',
    '--output-schema',
    executed[16],
    '--output-last-message',
    executed[18],
    '-',
  ];
  if (executed.length !== expected.length
      || canonicalJson(executed) !== canonicalJson(expected)
      || typeof executed[0] !== 'string'
      || requested[0] !== command?.executable?.invoked
      || executed[0] !== command?.executable?.resolvedPath
      || !path.isAbsolute(executed[0])
      || !path.isAbsolute(requested[0])
      || !path.isAbsolute(String(executed[16] || ''))
      || !path.isAbsolute(String(executed[18] || ''))
      || path.dirname(executed[18]) !== command?.cwd) {
    errors.push('model execution argv is not the exact stdin-only canonical worker command');
  }
  const securityCritical = [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox',
    '--skip-git-repo-check',
    '--model',
    '--config',
    '--cd',
    '--json',
    '--output-schema',
    '--output-last-message',
    '-',
  ];
  for (const option of securityCritical) {
    if (executed.filter((part) => part === option).length !== 1) {
      errors.push(`model execution argv duplicates or omits security-critical option: ${option}`);
    }
  }
  return errors;
}

export function validateExecutionEvidenceCore(core) {
  const errors = [];
  if (!exactKeys(core, [
    'bindings',
    'command',
    'environment',
    'executionKind',
    'input',
    'model',
    'outputs',
    'process',
    'schemaVersion',
  ])) {
    return { ok: false, errors: ['execution-evidence core fields are incomplete or unknown'] };
  }
  if (core.schemaVersion !== EXECUTION_EVIDENCE_CORE_SCHEMA
      || !['model', 'process'].includes(core.executionKind)) {
    errors.push('execution-evidence schema or execution kind is invalid');
  }

  const bindings = core.bindings;
  if (!exactKeys(bindings, [
    'campaignId',
    'campaignSha256',
    'candidateId',
    'candidateSessionId',
    'candidateSha256',
    'deploymentSha256',
    'jobId',
    'jobSha256',
    'sourceSha256',
    'taskId',
    'taskSha256',
  ])
      || !validOptionalIdentifier(bindings?.candidateId)
      || !IDENTIFIER.test(String(bindings?.candidateSessionId || ''))
      || !validOptionalIdentifier(bindings?.taskId)
      || !IDENTIFIER.test(String(bindings?.jobId || ''))
      || !IDENTIFIER.test(String(bindings?.campaignId || ''))
      || ![
        bindings?.candidateSha256,
        bindings?.taskSha256,
        bindings?.jobSha256,
        bindings?.campaignSha256,
        bindings?.deploymentSha256,
        bindings?.sourceSha256,
      ].every((value) => DIGEST.test(String(value || '')))) {
    errors.push('execution-evidence candidate, task, job, campaign, deployment, or source binding is invalid');
  }

  const environment = core.environment;
  if (!exactKeys(environment, [
    'declared',
    'declaredSha256',
    'observed',
    'observedSha256',
  ])
      || !isRecord(environment?.declared)
      || Object.keys(environment.declared).length < 1
      || !isRecord(environment?.observed)
      || Object.keys(environment.observed).length < 1
      || !DIGEST.test(String(environment?.declaredSha256 || ''))
      || !DIGEST.test(String(environment?.observedSha256 || ''))
      || environment.declaredSha256 !== digest(environment.declared)
      || environment.observedSha256 !== digest(environment.observed)) {
    errors.push('execution-evidence declared or observed environment is invalid');
  }

  const command = core.command;
  const executable = command?.executable;
  if (!exactKeys(command, [
    'cwd',
    'executedArgv',
    'executedArgvSha256',
    'executable',
    'requestedArgv',
    'requestedArgvSha256',
  ])
      || !Array.isArray(command?.requestedArgv) || command.requestedArgv.length < 1
      || !Array.isArray(command?.executedArgv) || command.executedArgv.length < 1
      || command.requestedArgv.some((part) => typeof part !== 'string' || part.length < 1 || part.length > 4096)
      || command.executedArgv.some((part) => typeof part !== 'string' || part.length < 1 || part.length > 4096)
      || !DIGEST.test(String(command?.requestedArgvSha256 || ''))
      || !DIGEST.test(String(command?.executedArgvSha256 || ''))
      || command.requestedArgvSha256 !== digest(command.requestedArgv)
      || command.executedArgvSha256 !== digest(command.executedArgv)
      || typeof command.cwd !== 'string' || !path.isAbsolute(command.cwd)
      || !exactKeys(executable, ['bytes', 'invoked', 'resolvedPath', 'sha256'])
      || executable.invoked !== command.requestedArgv[0]
      || (command.requestedArgv[0] !== command.executedArgv[0]
        && executable.resolvedPath !== command.executedArgv[0])
      || typeof executable.resolvedPath !== 'string' || !path.isAbsolute(executable.resolvedPath)
      || !Number.isSafeInteger(executable.bytes) || executable.bytes < 1
      || executable.bytes > MAX_EXECUTABLE_BYTES
      || !DIGEST.test(String(executable.sha256 || ''))) {
    errors.push('execution-evidence exact command, argv, cwd, or executable identity is invalid');
  }

  const processRecord = core.process;
  if (!exactKeys(processRecord, [
    'completedAt',
    'error',
    'exitCode',
    'signal',
    'startedAt',
  ])
      || !validTimestamp(processRecord?.startedAt)
      || !validTimestamp(processRecord?.completedAt)
      || Date.parse(processRecord.completedAt) < Date.parse(processRecord.startedAt)
      || !(processRecord.exitCode === null
        || (Number.isInteger(processRecord.exitCode)
          && processRecord.exitCode >= 0 && processRecord.exitCode <= 255))
      || !(processRecord.signal === null
        || (typeof processRecord.signal === 'string' && processRecord.signal.length > 0
          && processRecord.signal.length <= 64))
      || !(processRecord.error === null
        || (typeof processRecord.error === 'string' && processRecord.error.length > 0
          && processRecord.error.length <= 4096))) {
    errors.push('execution-evidence process start, completion, or exit status is invalid');
  }

  if (!validByteRecord(core.input, ['bytes', 'mediaType', 'name', 'sha256'])
      || core.input.bytes < 1) {
    errors.push('execution-evidence exact prompt/input byte record is invalid');
  }

  const outputs = core.outputs;
  if (!exactKeys(outputs, ['files', 'raw'])
      || !Array.isArray(outputs?.raw) || outputs.raw.length !== 2
      || !Array.isArray(outputs?.files)
      || outputs.files.length > 128) {
    errors.push('execution-evidence raw or output-file record set is invalid');
  } else {
    const rawNames = new Set();
    for (const record of outputs.raw) {
      if (!validByteRecord(record, ['bytes', 'mediaType', 'name', 'sha256'])
          || rawNames.has(record.name)) {
        errors.push('execution-evidence raw output record is invalid or duplicated');
      }
      rawNames.add(record?.name);
    }
    if (canonicalJson([...rawNames].sort()) !== canonicalJson(['stderr', 'stdout'])) {
      errors.push('execution-evidence must bind exact stdout and stderr records');
    }
    const filePaths = new Set();
    for (const record of outputs.files) {
      if (!validByteRecord(record, ['bytes', 'mediaType', 'name', 'path', 'sha256'])
          || !validSafeRelativePath(record.path)
          || filePaths.has(record.path)) {
        errors.push('execution-evidence output-file record is invalid or duplicated');
      }
      filePaths.add(record?.path);
    }
  }

  if (core.executionKind === 'model') {
    const model = core.model;
    const stdoutRecord = outputs?.raw?.find((record) => record?.name === 'stdout');
    const commandErrors = canonicalModelCommandErrors(command, model);
    errors.push(...commandErrors);
    if (!exactKeys(model, [
      'model',
      'plannedSessionId',
      'provider',
      'providerRequestId',
      'providerSessionId',
      'sandbox',
      'thinking',
      'toolsAllowed',
      'toolsUsed',
      'usage',
    ])
        || !IDENTIFIER.test(String(model?.provider || ''))
        || typeof model?.model !== 'string' || model.model.length < 1 || model.model.length > 256
        || !['xhigh', 'ultra'].includes(model.thinking)
        || model.sandbox !== 'read-only'
        || model.toolsAllowed !== false
        || !Array.isArray(model.toolsUsed) || model.toolsUsed.length !== 0
        || !validUsage(model.usage)
        || !validOptionalIdentifier(model.providerRequestId)
        || !IDENTIFIER.test(String(model.providerSessionId || ''))
        || model.plannedSessionId !== bindings?.candidateSessionId
        || stdoutRecord?.bytes < 1
        || outputs?.files?.length !== 1
        || outputs.files[0]?.bytes < 1
        || processRecord?.exitCode !== 0
        || processRecord?.signal !== null
        || processRecord?.error !== null) {
      errors.push('execution-evidence provider, model, thinking, tool policy, usage, or model process is invalid');
    }
  } else if (core.model !== null) {
    errors.push('non-model execution-evidence must not invent provider or model usage');
  }

  return { ok: errors.length === 0, errors };
}

export function executionEvidenceSha256(core) {
  const validation = validateExecutionEvidenceCore(core);
  if (!validation.ok) {
    throw new Error(`invalid canonical execution-evidence core: ${validation.errors.join('; ')}`);
  }
  return digest(core);
}

export function validateExecutionEvidenceRecord(record) {
  const errors = [];
  if (!exactKeys(record, ['core', 'executionEvidenceSha256'])) {
    return { ok: false, errors: ['execution-evidence record fields are incomplete or unknown'] };
  }
  const validation = validateExecutionEvidenceCore(record.core);
  errors.push(...validation.errors);
  if (!DIGEST.test(String(record.executionEvidenceSha256 || ''))
      || (validation.ok && record.executionEvidenceSha256 !== digest(record.core))) {
    errors.push('executionEvidenceSha256 does not match the exact canonical execution-evidence core');
  }
  return { ok: errors.length === 0, errors };
}

export function executionEvidenceRecord(core) {
  return {
    core: structuredClone(core),
    executionEvidenceSha256: executionEvidenceSha256(core),
  };
}

function byteRecord(name, mediaType, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || '');
  return {
    name,
    mediaType,
    bytes: bytes.length,
    sha256: sha256Bytes(bytes),
  };
}

export function createExecutionEvidenceCore({
  executionKind,
  bindings,
  declaredEnvironment,
  observedEnvironment,
  requestedArgv,
  executedArgv,
  executable,
  cwd,
  startedAt,
  completedAt,
  exitCode,
  signal = null,
  error = null,
  input,
  stdout = Buffer.alloc(0),
  stderr = Buffer.alloc(0),
  outputFiles,
  model = null,
} = {}) {
  const core = {
    schemaVersion: EXECUTION_EVIDENCE_CORE_SCHEMA,
    executionKind,
    bindings: structuredClone(bindings),
    environment: {
      declared: structuredClone(declaredEnvironment),
      declaredSha256: digest(declaredEnvironment),
      observed: structuredClone(observedEnvironment),
      observedSha256: digest(observedEnvironment),
    },
    command: {
      requestedArgv: structuredClone(requestedArgv),
      requestedArgvSha256: digest(requestedArgv),
      executedArgv: structuredClone(executedArgv),
      executedArgvSha256: digest(executedArgv),
      executable: structuredClone(executable),
      cwd: path.resolve(cwd),
    },
    process: {
      startedAt,
      completedAt,
      exitCode,
      signal,
      error,
    },
    input: byteRecord(input?.name, input?.mediaType, input?.bytes),
    outputs: {
      raw: [
        byteRecord('stdout', 'application/octet-stream', stdout),
        byteRecord('stderr', 'application/octet-stream', stderr),
      ],
      files: (outputFiles || []).map((record) => ({
        ...byteRecord(record.name, record.mediaType, record.bytes),
        path: record.path,
      })),
    },
    model: model === null ? null : structuredClone(model),
  };
  const validation = validateExecutionEvidenceCore(core);
  if (!validation.ok) {
    throw new Error(`cannot create canonical execution-evidence core: ${validation.errors.join('; ')}`);
  }
  return core;
}

export function verifyExecutionEvidenceBytes(core, {
  inputBytes,
  rawOutputs,
  outputFiles,
} = {}) {
  const errors = [];
  const validation = validateExecutionEvidenceCore(core);
  if (!validation.ok) return validation;
  const input = Buffer.isBuffer(inputBytes) ? inputBytes : Buffer.from(inputBytes || '');
  if (core.input.bytes !== input.length || core.input.sha256 !== sha256Bytes(input)) {
    errors.push('execution-evidence prompt/input bytes differ from the canonical core');
  }
  const suppliedRaw = isRecord(rawOutputs) ? rawOutputs : {};
  if (canonicalJson(Object.keys(suppliedRaw).sort())
      !== canonicalJson(core.outputs.raw.map((record) => record.name).sort())) {
    errors.push('execution-evidence raw output byte set is incomplete or detached');
  } else {
    for (const record of core.outputs.raw) {
      const bytes = Buffer.isBuffer(suppliedRaw[record.name])
        ? suppliedRaw[record.name]
        : Buffer.from(suppliedRaw[record.name] || '');
      if (record.bytes !== bytes.length || record.sha256 !== sha256Bytes(bytes)) {
        errors.push(`execution-evidence raw ${record.name} bytes differ from the canonical core`);
      }
    }
  }
  const suppliedFiles = isRecord(outputFiles) ? outputFiles : {};
  if (canonicalJson(Object.keys(suppliedFiles).sort())
      !== canonicalJson(core.outputs.files.map((record) => record.path).sort())) {
    errors.push('execution-evidence output-file byte set is incomplete or detached');
  } else {
    for (const record of core.outputs.files) {
      const bytes = Buffer.isBuffer(suppliedFiles[record.path])
        ? suppliedFiles[record.path]
        : Buffer.from(suppliedFiles[record.path] || '');
      if (record.bytes !== bytes.length || record.sha256 !== sha256Bytes(bytes)) {
        errors.push(`execution-evidence output file differs from the canonical core: ${record.path}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function observeExecutableIdentity(command, {
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  if (typeof command !== 'string' || command.length < 1) {
    throw new Error('cannot observe an empty executable command');
  }
  let invokedPath = null;
  if (path.isAbsolute(command)) invokedPath = command;
  else if (command.includes(path.sep)) invokedPath = path.resolve(cwd, command);
  else {
    for (const directory of String(env?.PATH || '').split(path.delimiter)) {
      if (!directory) continue;
      const candidate = path.join(directory, command);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        invokedPath = candidate;
        break;
      } catch {
        // Continue searching the exact PATH supplied to the process.
      }
    }
  }
  if (invokedPath === null) throw new Error(`executable identity is unavailable: ${command}`);
  const resolvedPath = fs.realpathSync(invokedPath);
  const stat = fs.lstatSync(resolvedPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_EXECUTABLE_BYTES) {
    throw new Error(`executable identity is unsafe or outside limits: ${command}`);
  }
  return {
    invoked: command,
    resolvedPath,
    bytes: stat.size,
    sha256: sha256File(resolvedPath),
  };
}

export function observeProcessEnvironment(env = process.env) {
  const variables = Object.entries(env || {}).sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => {
      const bytes = Buffer.from(String(value), 'utf8');
      return {
        name,
        bytes: bytes.length,
        sha256: sha256Bytes(bytes),
      };
    });
  return {
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    variables,
  };
}

export function executionSourceSha256(deployment) {
  if (!isRecord(deployment)
      || typeof deployment.sourceCommit !== 'string'
      || typeof deployment.sourceTree !== 'string') {
    throw new Error('execution source binding is unavailable');
  }
  return digest({
    sourceCommit: deployment.sourceCommit,
    sourceTree: deployment.sourceTree,
  });
}
