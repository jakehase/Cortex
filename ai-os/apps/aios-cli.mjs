#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { compileCanonicalAiosSource } from '../packages/aios-language/canonical.mjs';
import {
  executeCapabilityGatedProviderOperation,
  normalizeProviderPolicy,
  providerOperationFromSyscall,
  providerPolicyDigest,
} from '../packages/aios-language/runtime/provider-read-compute.mjs';

const command = process.argv[2] || 'help';
const known = ['help', 'compile', 'boot', 'run', 'claim', 'ps', 'logs', 'approve'];
const cliDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(cliDir, '..');
const defaultProviderPolicyPath = join(repoRoot, 'kernel', 'policy', 'provider-read-compute.json');

const EXIT_CODES = Object.freeze({
  success: 0,
  runtimeBlocked: 1,
  invalidInput: 2,
  operatorRejected: 3,
});

const exitCodeLabels = Object.freeze({
  [EXIT_CODES.success]: 'success',
  [EXIT_CODES.runtimeBlocked]: 'runtime_blocked_or_missing_artifact',
  [EXIT_CODES.invalidInput]: 'invalid_cli_input',
  [EXIT_CODES.operatorRejected]: 'operator_rejected_subject',
});

class AiosCliFailure extends Error {
  constructor(code, reason, details = {}) {
    super(reason);
    this.name = 'AiosCliFailure';
    this.code = code;
    this.reason = reason;
    this.details = details;
  }
}

const printJson = (payload) => {
  console.log(JSON.stringify(payload, null, 2));
};

const fail = (code, reason, details = {}) => {
  throw new AiosCliFailure(code, reason, details);
};

const usage = {
  help: 'aios help',
  compile: 'aios compile <source.aios> --artifact-root <path> [--workspace <id>] [--tenant <id>] [--role <role>] [--provider-policy <path>]',
  boot: 'aios boot --artifact-root <path> [--tenant <id>] [--role <role>] [--provider <id>] [--handoff-uri <uri>] [--kernel-contracts <path>] [--hosted-boot-module <path>] [--lifecycle enabled|disabled] [--scheduler immediate|hold] [--approvals required|optional]',
  run: 'aios run <job.json> --artifact-root <path> [--tenant <id>] [--role <role>] [--provider <id>] [--handoff-uri <uri>] [--provider-policy <path>]',
  claim: 'aios claim <job.json> --artifact-root <path> [--tenant <id>] [--role <role>] [--provider <id>] [--handoff-uri <uri>]',
  ps: 'aios ps --artifact-root <path> [--tenant <id>] [--role <role>] [--provider <id>] [--state <state>] [--strict-health]',
  logs: 'aios logs --artifact-root <path> [--tenant <id>] [--role <role>] [--provider <id>] [--process <processId>]',
  approve: 'aios approve --artifact-root <path> --subject <id> [--tenant <id>] [--role <role>] [--provider <id>] [--decision approve|reject] [--reason <text>] [--handoff-uri <uri>]',
};

const scopedCliOption = (tokens, name) => {
  const long = `--${name}`;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === long) {
      const next = tokens[index + 1];
      return next && !next.startsWith('--') ? next : true;
    }
    if (token.startsWith(`${long}=`)) {
      return token.slice(long.length + 1);
    }
  }
  return undefined;
};

const normalizeScopeToken = (value, fallback, label) => {
  const raw = value === undefined || value === null ? fallback : value;
  const normalized = String(raw || '').trim();
  if (!normalized) {
    fail(2, 'aios_cli_scope_value_missing', { label });
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/.test(normalized)) {
    fail(2, 'aios_cli_scope_value_invalid', {
      label,
      value: normalized,
      allowedPattern: '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$',
    });
  }
  return normalized;
};

const createOperatorScope = (descriptor) => {
  const tokens = process.argv.slice(3);
  const tenantId = normalizeScopeToken(
    scopedCliOption(tokens, 'tenant'),
    process.env.AIOS_TENANT_ID || process.env.AIOS_TENANT || 'default',
    'tenant',
  );
  const role = normalizeScopeToken(
    scopedCliOption(tokens, 'role'),
    process.env.AIOS_OPERATOR_ROLE || 'operator',
    'role',
  ).toLowerCase();
  const operator = normalizeScopeToken(
    scopedCliOption(tokens, 'operator'),
    process.env.AIOS_OPERATOR || process.env.USER || 'operator',
    'operator',
  );
  const allowedRoles = descriptor?.allowedRoles || ['operator', 'admin'];
  if (!allowedRoles.includes(role)) {
    fail(2, 'aios_cli_operator_role_not_permitted', {
      command,
      role,
      allowedRoles,
      tenantId,
    });
  }
  const scope = {
    contract: 'aios.operator.scope.v0',
    tenantId,
    role,
    operator,
    roleAcceptedForCommand: true,
    allowedRoles,
  };
  return {
    ...scope,
    scopeHash: sha256({
      contract: scope.contract,
      tenantId,
      role,
      operator,
      command,
      allowedRoles,
    }),
  };
};

const parseFlags = (tokens) => {
  const flags = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) {
      fail(2, 'aios_cli_unexpected_argument', { argument: token });
    }
    const inlineValueIndex = token.indexOf('=');
    if (inlineValueIndex > -1) {
      const key = token.slice(2, inlineValueIndex);
      flags[key] = token.slice(inlineValueIndex + 1);
      continue;
    }
    const key = token.slice(2);
    const next = tokens[index + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return flags;
};

const stableJson = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const sha256 = (value) => createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');

const resolveInsideWorkspace = (input, label) => {
  if (!input || typeof input !== 'string') {
    fail(2, 'aios_cli_missing_required_flag', { flag: label });
  }
  const resolved = resolve(process.cwd(), input);
  const relative = resolved.startsWith(repoRoot + '/') || resolved === repoRoot;
  const absoluteAllowed = isAbsolute(input) && (resolved.startsWith(repoRoot + '/') || resolved.startsWith('/tmp/'));
  if (!relative && !absoluteAllowed) {
    fail(2, 'aios_cli_path_outside_workspace', { flag: label, value: input });
  }
  return resolved;
};

const readJsonFile = async (path) => {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
};

const tryReadJsonFile = async (path) => {
  try {
    return await readJsonFile(path);
  } catch (error) {
    return { __aiosReadError: error.message };
  }
};

const parsePositionalCommand = (tokens, positionalName) => {
  const positional = [];
  const flagTokens = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith('--')) {
      flagTokens.push(token);
      if (token.includes('=')) {
        continue;
      }
      const next = tokens[index + 1];
      if (next && !next.startsWith('--')) {
        flagTokens.push(next);
        index += 1;
      }
      continue;
    }
    positional.push(token);
  }
  if (positional.length !== 1) {
    fail(2, 'aios_cli_invalid_positional_arguments', {
      expected: [positionalName],
      received: positional,
    });
  }
  return { positional: positional[0], flags: parseFlags(flagTokens) };
};

const readExistingJsonCandidate = async (artifactRoot, candidates, label) => {
  const attempted = candidates.map((candidate) => join(artifactRoot, candidate));
  for (const path of attempted) {
    if (!existsSync(path)) {
      continue;
    }
    try {
      const payload = await readJsonFile(path);
      return { path, payload, hash: sha256(payload), attempted };
    } catch (error) {
      fail(1, 'aios_cli_claim_artifact_invalid_json', { label, path, message: error.message });
    }
  }
  fail(1, 'aios_cli_claim_blocked_missing_artifact', { label, attempted });
};

const truthyGreenStatus = new Set(['ok', 'green', 'pass', 'passed', 'success', 'successful', 'verified']);

const collectBooleanChecks = (payload) => {
  const sources = [
    payload.checks,
    payload.acceptanceChecks,
    payload.verifierChecks,
    payload.evidence?.checks,
    payload.result?.checks,
  ].filter(Array.isArray);
  return sources.flat().filter((check) => check && typeof check === 'object');
};

const artifactIsGreen = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  if (payload.ok === true || payload.green === true || payload.passed === true || payload.verified === true) {
    return true;
  }
  const status = String(payload.status || payload.verdict || payload.result?.status || payload.result?.verdict || '').toLowerCase();
  if (truthyGreenStatus.has(status)) {
    return true;
  }
  const checks = collectBooleanChecks(payload);
  return checks.length > 0 && checks.every((check) => (
    check.ok === true
    || check.green === true
    || check.passed === true
    || truthyGreenStatus.has(String(check.status || check.verdict || '').toLowerCase())
  ));
};

const artifactFailureSummary = (payload) => ({
  ok: payload?.ok,
  status: payload?.status,
  verdict: payload?.verdict,
  resultStatus: payload?.result?.status,
  resultVerdict: payload?.result?.verdict,
  checkCount: collectBooleanChecks(payload).length,
});

const requireGreenArtifact = (artifact, label) => {
  if (!artifactIsGreen(artifact.payload)) {
    fail(1, 'aios_cli_claim_blocked_artifact_not_green', {
      label,
      path: artifact.path,
      summary: artifactFailureSummary(artifact.payload),
    });
  }
};

const evidenceLooksPresent = (payload) => (
  payload?.evidence
  || payload?.verifierEvidence
  || payload?.artifacts
  || payload?.checks
  || payload?.acceptanceChecks
  || payload?.verifierChecks
  || payload?.result?.evidence
);

const requireVerifierEvidence = (artifact) => {
  requireGreenArtifact(artifact, 'verifier_evidence');
  if (!evidenceLooksPresent(artifact.payload)) {
    fail(1, 'aios_cli_claim_blocked_missing_verifier_evidence', {
      label: 'verifier_evidence',
      path: artifact.path,
      requiredAnyOf: [
        'evidence',
        'verifierEvidence',
        'artifacts',
        'checks',
        'acceptanceChecks',
        'verifierChecks',
        'result.evidence',
      ],
    });
  }
};

const runRoute = 'L24_nexus+L27_forge+L20_simulator+L7_librarian_context_governor';
const runPacketType = 'aios.run.proof';
const invocationStartedAt = new Date().toISOString();
const invocationArgv = process.argv.slice(2);
const allowedKernelSyscalls = new Set([
  'kernel.echo',
  'kernel.record',
  'kernel.artifact.status',
  'kernel.complete',
  'process.admit',
  'process.transition',
  'provider.read',
  'provider.compute',
]);
const syscallAllowedByKernelPolicy = (op) => allowedKernelSyscalls.has(op) || op.startsWith('kernel.');

const compactClientRuntime = () => ({
  cwd: process.cwd(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  pid: process.pid,
  shell: process.env.SHELL || null,
  operator: process.env.AIOS_OPERATOR || process.env.USER || null,
  ci: process.env.CI === 'true',
  tty: {
    stdin: Boolean(process.stdin.isTTY),
    stdout: Boolean(process.stdout.isTTY),
    stderr: Boolean(process.stderr.isTTY),
  },
});

const workflowHandoffFor = ({ commandName, artifactRoot = null, jobPath = null, processId = null, subject = null }) => {
  const artifactFlag = artifactRoot ? ['--artifact-root', artifactRoot] : ['--artifact-root', '<artifact-root>'];
  if (commandName === 'boot') {
    return {
      currentStage: 'boot_proof_written',
      nextCommands: [
        ['aios', 'run', jobPath || '<job.json>', ...artifactFlag],
        ['aios', 'ps', ...artifactFlag],
      ],
    };
  }
  if (commandName === 'run') {
    return {
      currentStage: 'process_completed',
      nextCommands: [
        ['aios', 'logs', ...artifactFlag, '--process', processId || '<processId>'],
        ['aios', 'claim', jobPath || '<job.json>', ...artifactFlag],
      ],
    };
  }
  if (commandName === 'claim') {
    return {
      currentStage: 'completion_claim_allowed',
      nextCommands: [
        ['aios', 'approve', ...artifactFlag, '--subject', subject || '<claim-subject>'],
      ],
    };
  }
  if (commandName === 'ps') {
    return {
      currentStage: 'process_table_read',
      nextCommands: [
        ['aios', 'logs', ...artifactFlag, '--process', processId || '<processId>'],
      ],
    };
  }
  if (commandName === 'logs') {
    return {
      currentStage: 'lifecycle_log_read',
      nextCommands: [
        ['aios', 'ps', ...artifactFlag],
      ],
    };
  }
  if (commandName === 'approve') {
    return {
      currentStage: 'operator_decision_recorded',
      nextCommands: [
        ['aios', 'ps', ...artifactFlag],
      ],
    };
  }
  return {
    currentStage: 'operator_help',
    nextCommands: [['aios', 'boot', ...artifactFlag]],
  };
};

const commandPreviewCatalog = Object.freeze({
  help: {
    action: 'Describe available AI OS operator commands.',
    producedContract: 'aios.operator.help',
    reads: [],
  },
  boot: {
    action: 'Initialize an artifact root and write boot readiness artifacts.',
    producedContract: 'aios.boot.proof',
    reads: ['kernel_contracts'],
  },
  run: {
    action: 'Admit a job, execute mediated syscalls, and persist a process record.',
    producedContract: runPacketType,
    reads: ['job_json', 'tenant_boundary', 'lifecycle_settings', 'provider_contract'],
  },
  claim: {
    action: 'Validate green boot/run/verifier evidence and create a completion claim.',
    producedContract: 'aios.completion.claim',
    reads: ['job_json', 'boot_proof', 'run_proof', 'verifier_evidence'],
  },
  ps: {
    action: 'Read process table state, health, reconciliation, and fleet analytics.',
    producedContract: 'aios.operator.ps',
    reads: ['process_index', 'process_records'],
  },
  logs: {
    action: 'Read lifecycle events and log analytics from process records.',
    producedContract: 'aios.operator.logs',
    reads: ['process_records'],
  },
  approve: {
    action: 'Record an operator approval or rejection for a claim subject.',
    producedContract: 'aios.operator.approval',
    reads: ['provider_contract'],
  },
});

const expectedInputsForCommand = (commandName) => {
  if (commandName === 'run' || commandName === 'claim') {
    return ['artifactRoot', 'jobPath', 'tenantId'];
  }
  if (commandName === 'approve') {
    return ['artifactRoot', 'subject', 'tenantId'];
  }
  if (['boot', 'ps', 'logs'].includes(commandName)) {
    return ['artifactRoot', 'tenantId'];
  }
  return [];
};

const acceptanceChecksForState = (state) => {
  const outputs = state.outputs || {};
  const checksByCommand = {
    help: [
      ['commands_listed', Number.isInteger(outputs.commandCount) && outputs.commandCount > 0],
    ],
    boot: [
      ['boot_proof_path_available', typeof outputs.bootProofPacket === 'string'],
      ['manifest_path_available', typeof outputs.manifestPath === 'string'],
      ['provider_sync_recorded', Number.isInteger(outputs.providerSyncRevision)],
    ],
    run: [
      ['process_id_available', typeof outputs.processId === 'string'],
      ['lifecycle_policy_reported', typeof outputs.lifecycleNextAction === 'string'],
    ],
    claim: [
      ['claim_subject_available', typeof outputs.claimSubject === 'string'],
      ['required_artifact_hashes_available', Boolean(outputs.requiredArtifactHashes)],
      ['approval_requirement_reported', typeof outputs.approvalRequirement === 'string'],
    ],
    ps: [
      ['process_count_reported', Number.isInteger(outputs.processCount)],
      ['health_mode_reported', typeof outputs.healthMode === 'string'],
      ['analytics_snapshot_available', typeof outputs.analyticsSnapshotHash === 'string'],
    ],
    logs: [
      ['event_count_reported', Number.isInteger(outputs.eventCount)],
      ['analytics_snapshot_available', typeof outputs.analyticsSnapshotHash === 'string'],
    ],
    approve: [
      ['approval_path_available', typeof outputs.approvalPath === 'string'],
      ['latest_packet_path_available', typeof outputs.latestPath === 'string'],
      ['decision_recorded', Object.prototype.hasOwnProperty.call(outputs, 'rejected')],
    ],
  };
  return (checksByCommand[state.command] || []).map(([name, passed]) => ({
    name,
    passed: Boolean(passed),
  }));
};

const buildUserVisibleRouteContract = (state) => {
  const preview = commandPreviewCatalog[state.command] || commandPreviewCatalog.help;
  const inputs = state.inputs || {};
  const outputs = state.outputs || {};
  const expectedInputs = expectedInputsForCommand(state.command);
  const missingInputs = expectedInputs.filter((name) => inputs[name] === undefined || inputs[name] === null || inputs[name] === '');
  const acceptanceChecks = acceptanceChecksForState(state);
  const completedAcceptance = acceptanceChecks.filter((check) => check.passed).length;
  const providerSummary = inputs.providerContract || outputs.providerContract || null;
  const handoff = state.handoff || workflowHandoffFor({ commandName: state.command });
  const contract = {
    contract: 'aios.operator.user_visible_route_contract.v0',
    command: state.command,
    route: runRoute,
    packetType: preview.producedContract,
    preview: {
      action: preview.action,
      target: inputs.jobPath || inputs.processId || inputs.subject || state.artifactRoot || state.command,
      artifactRoot: state.artifactRoot || null,
      reads: preview.reads,
      produces: preview.producedContract,
    },
    readiness: {
      ready: missingInputs.length === 0,
      state: missingInputs.length === 0 ? 'ready_for_route_handler' : 'waiting_for_required_inputs',
      missingInputs,
      requiredInputs: expectedInputs,
    },
    validationSummary: {
      expectedInputCount: expectedInputs.length,
      presentInputCount: expectedInputs.length - missingInputs.length,
      tenantScoped: Boolean(state.tenantBoundary || inputs.tenantId),
      providerNegotiated: Boolean(providerSummary?.hash || providerSummary?.path),
      lifecycleState: inputs.lifecycleSettings || outputs.lifecycleNextAction || null,
    },
    acceptance: {
      state: acceptanceChecks.length === 0
        ? 'not_applicable'
        : completedAcceptance === acceptanceChecks.length
          ? 'satisfied'
          : completedAcceptance > 0
            ? 'partially_satisfied'
            : 'pending',
      completed: completedAcceptance,
      total: acceptanceChecks.length,
      checks: acceptanceChecks,
    },
    nextStep: {
      state: handoff.currentStage,
      commands: handoff.nextCommands,
      explanation: `After ${state.command}, clients can follow the first listed command when its placeholders are resolved.`,
    },
  };
  return {
    ...contract,
    contractHash: sha256({
      command: contract.command,
      packetType: contract.packetType,
      preview: contract.preview,
      readiness: contract.readiness,
      validationSummary: contract.validationSummary,
      acceptance: contract.acceptance,
      nextStep: contract.nextStep,
    }),
  };
};

const createOperatorRequestContext = (descriptor) => {
  const operatorScope = createOperatorScope(descriptor);
  const base = {
    contract: 'aios.operator.request.v0',
    command,
    argv: invocationArgv,
    route: runRoute,
    operatorUserlandModule: descriptor?.moduleId || null,
    expectedPacketType: descriptor?.packetType || null,
    startedAt: invocationStartedAt,
    operatorScope,
    client: compactClientRuntime(),
  };
  return {
    ...base,
    requestId: `aiosreq_${sha256(base).slice(0, 16)}`,
    argvHash: sha256(invocationArgv),
    handoff: workflowHandoffFor({ commandName: command }),
  };
};

const withOperatorRequestState = (context, updates = {}) => {
  const next = {
    ...context,
    artifactRoot: updates.artifactRoot || context.artifactRoot || null,
    tenantBoundary: updates.tenantBoundary || context.tenantBoundary || null,
    inputs: {
      ...(context.inputs || {}),
      ...(updates.inputs || {}),
    },
    outputs: {
      ...(context.outputs || {}),
      ...(updates.outputs || {}),
    },
  };
  next.handoff = workflowHandoffFor({
    commandName: next.command,
    artifactRoot: next.artifactRoot,
    jobPath: next.inputs.jobPath,
    processId: next.outputs.processId || next.inputs.processId,
    subject: next.outputs.claimSubject || next.inputs.subject,
  });
  next.userVisibleContract = buildUserVisibleRouteContract(next);
  next.stateHash = sha256({
    contract: next.contract,
    requestId: next.requestId,
    command: next.command,
    operatorScope: next.operatorScope,
    artifactRoot: next.artifactRoot,
    tenantBoundary: next.tenantBoundary,
    inputs: next.inputs,
    outputs: next.outputs,
    handoff: next.handoff,
    userVisibleContract: next.userVisibleContract,
  });
  return next;
};

const validateJobDocument = (job, jobPath) => {
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    fail(2, 'aios_cli_run_job_must_be_object', { jobPath });
  }
  const rawId = job.id ?? job.jobId ?? job.name ?? 'anonymous-job';
  if (typeof rawId !== 'string' || rawId.trim().length === 0) {
    fail(2, 'aios_cli_run_job_id_invalid', { jobPath, field: 'id|jobId|name' });
  }
  return {
    id: rawId.trim(),
    title: typeof job.title === 'string' ? job.title : null,
    hash: sha256(job),
  };
};

const normalizeSyscallName = (candidate) => {
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    return null;
  }
  const trimmed = candidate.trim();
  return trimmed.includes('.') ? trimmed : `kernel.${trimmed}`;
};

const normalizeSyscallRequest = (entry, index) => {
  if (typeof entry === 'string') {
    return { ordinal: index + 1, op: normalizeSyscallName(entry), args: {} };
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    fail(2, 'aios_cli_run_invalid_syscall', { index, expected: 'string_or_object' });
  }
  const op = normalizeSyscallName(entry.op ?? entry.syscall ?? entry.type ?? entry.name);
  const args = entry.args ?? entry.input ?? entry.payload ?? {};
  if (!op) {
    fail(2, 'aios_cli_run_missing_syscall_name', { index });
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    fail(2, 'aios_cli_run_invalid_syscall_args', { index, op });
  }
  return { ordinal: index + 1, op, args };
};

const extractJobSyscalls = (job, jobMeta) => {
  const declared = Array.isArray(job.syscalls)
    ? job.syscalls
    : Array.isArray(job.steps)
      ? job.steps.map((step) => step?.syscall ?? step)
      : Array.isArray(job.actions)
        ? job.actions
        : [];
  const normalized = declared.map(normalizeSyscallRequest);
  if (normalized.length > 0) {
    return normalized;
  }
  const message = typeof job.message === 'string'
    ? job.message
    : typeof job.prompt === 'string'
      ? job.prompt
      : `AI OS process ${jobMeta.id} admitted`;
  return [
    {
      ordinal: 1,
      op: 'kernel.echo',
      args: { message },
      synthesized: true,
    },
  ];
};

const appendLifecycle = (events, state, details = {}) => {
  const event = {
    ordinal: events.length + 1,
    state,
    at: new Date().toISOString(),
    ...details,
  };
  events.push(event);
  return event;
};

const processIndexPath = (artifactRoot) => join(artifactRoot, 'processes', 'process-index.json');

const normalizeProcessIndex = (payload, path) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      path,
      readable: false,
      processCount: 0,
      entries: [],
      error: 'process_index_must_be_object',
    };
  }
  const entries = Array.isArray(payload.processes)
    ? payload.processes.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    : [];
  return {
    path,
    readable: !payload.__aiosReadError,
    generatedAt: payload.generatedAt || null,
    updatedBy: payload.updatedBy || null,
    artifactRoot: payload.artifactRoot || null,
    indexHash: payload.indexHash || null,
    processCount: entries.length,
    entries,
    error: payload.__aiosReadError,
  };
};

const readProcessIndex = async (artifactRoot) => {
  const path = processIndexPath(artifactRoot);
  if (!existsSync(path)) {
    return normalizeProcessIndex({ processes: [] }, path);
  }
  return normalizeProcessIndex(await tryReadJsonFile(path), path);
};

const indexedProcessSummary = (record, recordPath) => ({
  processId: record.processId,
  state: record.state,
  jobId: record.job?.id || null,
  jobHash: record.job?.hash || null,
  route: record.route || null,
  requestId: record.operatorRequest?.requestId || null,
  operatorUserlandModule: record.operatorRequest?.operatorUserlandModule || null,
  recordPath,
  recordHash: record.recordHash || null,
  updatedAt: Array.isArray(record.lifecycle) && record.lifecycle.length > 0
    ? record.lifecycle[record.lifecycle.length - 1]?.at || null
    : null,
});

const writeProcessIndex = async ({ artifactRoot, processesDir, processRecord, processPath }) => {
  const previous = await readProcessIndex(artifactRoot);
  const summary = indexedProcessSummary(processRecord, processPath);
  const entriesById = new Map();
  for (const entry of previous.entries) {
    if (typeof entry.processId === 'string' && entry.processId) {
      entriesById.set(entry.processId, entry);
    }
  }
  entriesById.set(summary.processId, summary);
  const processes = [...entriesById.values()]
    .sort((left, right) => String(left.processId || '').localeCompare(String(right.processId || '')));
  const index = {
    ok: true,
    packetType: 'aios.process.index',
    route: runRoute,
    artifactRoot,
    generatedAt: new Date().toISOString(),
    updatedBy: 'aios-cli run',
    processes,
  };
  index.indexHash = sha256({
    packetType: index.packetType,
    route: index.route,
    artifactRoot,
    processes,
  });
  const path = join(processesDir, 'process-index.json');
  await writeFile(path, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return {
    path,
    hash: index.indexHash,
    processCount: processes.length,
    updatedProcessId: summary.processId,
  };
};

const terminalProcessStates = new Set(['completed', 'failed', 'cancelled', 'rejected']);

const lifecycleTimestampRange = (lifecycle) => {
  const timestamps = Array.isArray(lifecycle)
    ? lifecycle.map((event) => event?.at).filter((value) => typeof value === 'string' && value)
    : [];
  return {
    first: timestamps[0] || null,
    last: timestamps[timestamps.length - 1] || null,
  };
};

const countBy = (items, selector) => {
  const counts = {};
  for (const item of items) {
    const key = selector(item);
    if (!key) {
      continue;
    }
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
};

const millisecondsBetween = (startedAt, endedAt) => {
  const start = Date.parse(startedAt || '');
  const end = Date.parse(endedAt || '');
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
};

const shapeTimelineEvents = (lifecycle) => {
  const events = Array.isArray(lifecycle) ? lifecycle : [];
  return events.map((event, index) => {
    const previous = index > 0 ? events[index - 1] : null;
    return {
      ordinal: event?.ordinal ?? index + 1,
      state: event?.state || 'unknown',
      at: event?.at || null,
      deltaMsFromPrevious: previous ? millisecondsBetween(previous.at, event?.at) : 0,
      processId: event?.processId || null,
      syscall: event?.syscall || null,
      resultHash: event?.resultHash || null,
    };
  });
};

const buildProcessAnalytics = ({ processId, state, job, lifecycle, syscallResults, recordPath = null }) => {
  const safeLifecycle = Array.isArray(lifecycle) ? lifecycle : [];
  const safeSyscalls = Array.isArray(syscallResults) ? syscallResults : [];
  const timeline = shapeTimelineEvents(safeLifecycle);
  const range = lifecycleTimestampRange(safeLifecycle);
  const syscallCounts = countBy(safeSyscalls, (result) => result?.op || 'unknown');
  const stateCounts = countBy(safeLifecycle, (event) => event?.state || 'unknown');
  const completedSyscallCount = safeSyscalls.filter((result) => result?.ok === true).length;
  const summary = {
    processId,
    state: state || 'unknown',
    jobId: job?.id || null,
    jobHash: job?.hash || null,
    eventCount: safeLifecycle.length,
    syscallCount: safeSyscalls.length,
    completedSyscallCount,
    failedSyscallCount: Math.max(0, safeSyscalls.length - completedSyscallCount),
    firstEventAt: range.first,
    lastEventAt: range.last,
    durationMs: millisecondsBetween(range.first, range.last),
    terminal: terminalProcessStates.has(state),
    recordPath,
  };
  return {
    contract: 'aios.operator.process_analytics.v0',
    generatedAt: new Date().toISOString(),
    summary,
    counters: {
      lifecycleStates: stateCounts,
      syscalls: syscallCounts,
    },
    historySnapshot: {
      processId,
      jobId: summary.jobId,
      state: summary.state,
      eventCount: summary.eventCount,
      syscallCount: summary.syscallCount,
      firstEventAt: summary.firstEventAt,
      lastEventAt: summary.lastEventAt,
      durationMs: summary.durationMs,
      snapshotHash: sha256({ summary, stateCounts, syscallCounts }),
    },
    exportSummary: {
      format: 'json',
      schema: 'aios.operator.process_export_summary.v0',
      stableKey: processId,
      columns: ['processId', 'jobId', 'state', 'eventCount', 'syscallCount', 'durationMs', 'firstEventAt', 'lastEventAt'],
      row: {
        processId,
        jobId: summary.jobId,
        state: summary.state,
        eventCount: summary.eventCount,
        syscallCount: summary.syscallCount,
        durationMs: summary.durationMs,
        firstEventAt: summary.firstEventAt,
        lastEventAt: summary.lastEventAt,
      },
    },
    timeline,
  };
};

const buildFleetAnalytics = ({ records, processIndex, reconciliation }) => {
  const readableRecords = records.filter((record) => record.readable && record.payload && !record.payload.__aiosReadError);
  const processAnalytics = readableRecords.map((record) => buildProcessAnalytics({
    processId: record.payload.processId || null,
    state: record.payload.state || 'unknown',
    job: record.payload.job || null,
    lifecycle: record.payload.lifecycle,
    syscallResults: record.payload.syscallResults,
    recordPath: record.path,
  }));
  const allTimelineEvents = processAnalytics
    .flatMap((analytics) => analytics.timeline)
    .sort((left, right) => String(left.at || '').localeCompare(String(right.at || '')) || Number(left.ordinal || 0) - Number(right.ordinal || 0));
  const range = lifecycleTimestampRange(allTimelineEvents);
  const rows = processAnalytics.map((analytics) => analytics.exportSummary.row);
  return {
    contract: 'aios.operator.fleet_analytics.v0',
    generatedAt: new Date().toISOString(),
    artifactIndexHash: processIndex.indexHash || null,
    counters: {
      readableProcessCount: readableRecords.length,
      indexedProcessCount: processIndex.entries.length,
      lifecycleEventCount: allTimelineEvents.length,
      syscallCount: processAnalytics.reduce((total, analytics) => total + analytics.summary.syscallCount, 0),
      stateCounts: countBy(readableRecords, (record) => record.payload?.state || 'unknown'),
      reconciliationIssueCount: [
        ...(reconciliation.missingRecordIds || []),
        ...(reconciliation.unindexedRecordIds || []),
        ...(reconciliation.hashMismatches || []),
      ].length,
    },
    historySnapshot: {
      firstEventAt: range.first,
      lastEventAt: range.last,
      durationMs: millisecondsBetween(range.first, range.last),
      latestProcesses: rows
        .slice()
        .sort((left, right) => String(right.lastEventAt || '').localeCompare(String(left.lastEventAt || '')))
        .slice(0, 10),
      snapshotHash: sha256({ rows, reconciliation, indexHash: processIndex.indexHash || null }),
    },
    exportSummary: {
      format: 'json',
      schema: 'aios.operator.fleet_export_summary.v0',
      columns: ['processId', 'jobId', 'state', 'eventCount', 'syscallCount', 'durationMs', 'firstEventAt', 'lastEventAt'],
      rows,
    },
  };
};

const recomputeProcessRecordHash = (record) => {
  const hashInput = {
    processId: record.processId,
    job: record.job,
    state: record.state,
    route: record.route,
    operatorRequest: record.operatorRequest,
    lifecycle: record.lifecycle,
    syscallResults: record.syscallResults,
  };
  if (Object.prototype.hasOwnProperty.call(record, 'lifecycleSettings')) {
    hashInput.lifecycleSettings = record.lifecycleSettings;
  }
  if (Object.prototype.hasOwnProperty.call(record, 'providerContract')) {
    hashInput.providerContract = record.providerContract;
  }
  if (Object.prototype.hasOwnProperty.call(record, 'providerPolicy')) {
    hashInput.providerPolicy = record.providerPolicy;
  }
  return sha256(hashInput);
};

const shapeRecoveredProcessRecord = ({ payload, processId, jobMeta, processPath }) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { reusable: false, reason: 'process_record_must_be_object', processPath };
  }
  if (payload.processId !== processId) {
    return {
      reusable: false,
      reason: 'process_record_id_mismatch',
      processPath,
      expectedProcessId: processId,
      actualProcessId: payload.processId || null,
    };
  }
  if (payload.job?.hash !== jobMeta.hash) {
    return {
      reusable: false,
      reason: 'process_record_job_hash_mismatch',
      processPath,
      expectedJobHash: jobMeta.hash,
      actualJobHash: payload.job?.hash || null,
    };
  }
  if (!terminalProcessStates.has(payload.state)) {
    return {
      reusable: false,
      reason: 'process_record_not_terminal',
      processPath,
      state: payload.state || null,
    };
  }
  const computedHash = recomputeProcessRecordHash(payload);
  if (payload.recordHash && payload.recordHash !== computedHash) {
    return {
      reusable: false,
      reason: 'process_record_hash_mismatch',
      processPath,
      expectedRecordHash: computedHash,
      actualRecordHash: payload.recordHash,
    };
  }
  const lifecycleRange = lifecycleTimestampRange(payload.lifecycle);
  return {
    reusable: payload.state === 'completed',
    reason: payload.state === 'completed' ? 'completed_process_record_recovered' : 'terminal_non_success_process_record_recovered',
    processPath,
    processId,
    state: payload.state,
    recordHash: payload.recordHash || computedHash,
    lifecycleCount: Array.isArray(payload.lifecycle) ? payload.lifecycle.length : 0,
    syscallCount: Array.isArray(payload.syscallResults) ? payload.syscallResults.length : 0,
    firstLifecycleAt: lifecycleRange.first,
    lastLifecycleAt: lifecycleRange.last,
    record: payload.recordHash ? payload : { ...payload, recordHash: computedHash },
  };
};

const readReusableProcessRecord = async ({ processPath, processId, jobMeta }) => {
  if (!existsSync(processPath)) {
    return {
      reusable: false,
      reason: 'process_record_missing',
      processPath,
      processId,
    };
  }
  try {
    const payload = await readJsonFile(processPath);
    return shapeRecoveredProcessRecord({ payload, processId, jobMeta, processPath });
  } catch (error) {
    return {
      reusable: false,
      reason: 'process_record_unreadable',
      processPath,
      processId,
      message: error.message,
    };
  }
};

const buildRunProofPacket = ({
  operatorRequest,
  artifactRoot,
  processRecord,
  processPath,
  processIndex,
  job,
  syscallResults,
  lifecycle,
  lifecycleSettings = null,
  providerContract = null,
  providerPolicyState = null,
  restartSafety,
}) => {
  const processAnalytics = buildProcessAnalytics({
    processId: processRecord.processId,
    state: processRecord.state,
    job: processRecord.job,
    lifecycle,
    syscallResults,
    recordPath: processPath,
  });
  const runProof = {
    ok: true,
    command: 'run',
    packetType: runPacketType,
    operatorUserlandModule: 'aios.operator.userland.run.v0',
    route: runRoute,
    operatorRequest,
    generatedAt: new Date().toISOString(),
    artifactRoot,
    process: {
      id: processRecord.processId,
      state: processRecord.state,
      recordPath: processPath,
      recordHash: processRecord.recordHash,
      indexPath: processIndex.path,
      indexHash: processIndex.hash,
    },
    job,
    lifecycleSettings,
    kernelMediation: {
      processAdmission: 'aios.kernel.process_table.v0',
      syscallMediator: 'aios.kernel.syscall.v0',
      allowedSyscalls: [...allowedKernelSyscalls, 'kernel.*'].sort(),
      syscallCount: syscallResults.length,
    },
    providerContract,
    providerPolicy: providerPolicyState,
    restartSafety,
    analytics: processAnalytics,
    processIndex,
    lifecycle,
    syscallResults,
  };
  runProof.proofHash = sha256({
    packetType: runPacketType,
    route: runRoute,
    operatorRequest,
    artifactRoot,
    process: runProof.process,
    job: runProof.job,
    lifecycleSettings,
    providerContract,
    providerPolicy: providerPolicyState,
    kernelMediation: runProof.kernelMediation,
    restartSafety,
    analytics: processAnalytics,
    processIndex,
    lifecycle,
    syscallResults,
  });
  return runProof;
};

const inspectArtifactStatus = async (artifactRoot) => {
  const readPacket = async (relativePath) => {
    const packetPath = join(artifactRoot, relativePath);
    if (!existsSync(packetPath)) return null;
    const payload = await tryReadJsonFile(packetPath);
    return payload?.__aiosReadError ? null : payload;
  };
  const boot = await readPacket(join('packets', 'boot-proof.packet.json'));
  const runProof = await readPacket(join('packets', 'run-proof.packet.json'));
  const verifier = await readPacket(join('packets', 'verifier-evidence.packet.json'));
  const claim = await readPacket(join('packets', 'completion-claim.packet.json'));
  const processIndex = await readPacket(join('processes', 'process-index.json'));
  return {
    artifactRoot,
    observedAt: new Date().toISOString(),
    bootOk: boot?.ok === true,
    priorRunOk: runProof?.ok === true,
    verifierOk: verifier?.ok === true,
    claimStatus: claim?.claimStatus ?? null,
    processCount: Array.isArray(processIndex?.processes) ? processIndex.processes.length : 0,
  };
};

const executeKernelSyscalls = async ({ artifactRoot, processId, jobMeta, syscallRequests, lifecycle, providerPolicy, providerAccess }) => {
  const results = [];
  for (const request of syscallRequests) {
    if (!syscallAllowedByKernelPolicy(request.op)) {
      fail(2, 'aios_cli_run_syscall_not_allowed', {
        processId,
        op: request.op,
        allowed: [...allowedKernelSyscalls, 'kernel.*'].sort(),
      });
    }
    appendLifecycle(lifecycle, 'syscall_dispatched', { processId, syscall: request.op, ordinal: request.ordinal });
    const providerOperation = providerOperationFromSyscall(request.op);
    const output = providerOperation
      ? await executeCapabilityGatedProviderOperation({
        policy: providerPolicy,
        access: providerAccess,
        op: request.op,
        args: request.args,
        artifactRoot,
        processId,
        ordinal: request.ordinal,
      })
      : request.op === 'kernel.echo'
      ? { echoed: String(request.args.message ?? request.args.text ?? '') }
      : request.op === 'kernel.record'
        ? { recorded: request.args }
        : request.op === 'kernel.artifact.status'
          ? await inspectArtifactStatus(artifactRoot)
        : request.op === 'kernel.complete'
          ? { completion: request.args.status ?? 'complete' }
      : request.op === 'process.admit'
        ? { admitted: processId, jobId: jobMeta.id }
        : request.op === 'process.transition'
          ? { transition: request.args.state ?? 'running' }
          : { recordedKernelSyscall: request.op, payload: request.args };
    const result = {
      ordinal: request.ordinal,
      op: request.op,
      mediatedBy: 'aios.kernel.syscall.v0',
      ok: true,
      argsHash: sha256(request.args),
      output,
      outputHash: sha256(output),
    };
    results.push(result);
    appendLifecycle(lifecycle, 'syscall_completed', { processId, syscall: request.op, ordinal: request.ordinal, resultHash: result.outputHash });
  }
  return results;
};

const candidateContractPaths = (flags) => [
  flags['kernel-contracts'],
  process.env.AIOS_KERNEL_CONTRACTS,
  join(repoRoot, 'kernel', 'contracts.json'),
  join(repoRoot, 'contracts', 'kernel.json'),
  join(repoRoot, 'artifacts', 'aios-v0', 'kernel-contracts.json'),
].filter(Boolean);

const defaultKernelContracts = () => ({
  contractId: 'aios.kernel.boot.v0',
  surface: 'cli_boot_command',
  requiredPhases: [
    'load_kernel_contracts',
    'initialize_artifact_root',
    'invoke_hosted_boot_sequence',
    'write_boot_proof_packet',
  ],
  proofSchema: {
    packetType: 'aios.boot.proof',
    route: 'L24_nexus+L27_forge+L20_simulator+L7_librarian_context_governor',
    artifactRootRequired: true,
  },
});

const loadKernelContracts = async (flags) => {
  const attempts = [];
  for (const path of candidateContractPaths(flags)) {
    const resolved = isAbsolute(path) ? path : resolve(process.cwd(), path);
    attempts.push(resolved);
    if (!existsSync(resolved)) {
      continue;
    }
    try {
      const contracts = await readJsonFile(resolved);
      return {
        source: resolved,
        loaded: true,
        contracts,
        contractHash: sha256(contracts),
        attempts,
      };
    } catch (error) {
      fail(1, 'aios_cli_kernel_contracts_invalid', { path: resolved, message: error.message });
    }
  }
  const contracts = defaultKernelContracts();
  return {
    source: 'embedded:aios.kernel.boot.v0',
    loaded: true,
    embeddedFallback: true,
    contracts,
    contractHash: sha256(contracts),
    attempts,
  };
};

const loadProviderPolicy = async (flags) => {
  const policyPath = flags['provider-policy']
    ? resolveInsideWorkspace(flags['provider-policy'], '--provider-policy')
    : defaultProviderPolicyPath;
  if (!existsSync(policyPath)) {
    fail(EXIT_CODES.runtimeBlocked, 'aios_cli_provider_policy_missing', { policyPath });
  }
  let policy;
  try {
    policy = normalizeProviderPolicy(await readJsonFile(policyPath));
  } catch (error) {
    fail(EXIT_CODES.invalidInput, 'aios_cli_provider_policy_invalid', { policyPath, message: error.message });
  }
  return {
    path: policyPath,
    policy,
    digest: providerPolicyDigest(policy),
  };
};

const tenantBoundaryPath = (artifactRoot) => join(artifactRoot, '.aios-tenant-boundary.json');
const lifecycleSettingsPath = (artifactRoot) => join(artifactRoot, 'aios-lifecycle-settings.json');
const providerContractPath = (artifactRoot) => join(artifactRoot, 'aios-provider-contract.json');

const providerCapabilityCatalog = Object.freeze({
  artifact_root_sync: 'Read and update artifact-root metadata created by this CLI surface.',
  boot_proof_write: 'Write boot proof packets and artifact layout manifests.',
  process_lifecycle_write: 'Admit jobs, execute mediated syscalls, and persist process records.',
  completion_claim: 'Validate green artifacts and produce completion claim packets.',
  process_table_read: 'Read process records, health, reconciliation, and fleet analytics.',
  lifecycle_log_read: 'Read lifecycle events and logs analytics for operator review.',
  operator_approval_write: 'Write approval or rejection packets for claim subjects.',
  external_handoff_state: 'Expose stable state for external provider handoff orchestration.',
  provider_read: 'Execute capability-gated provider reads and retain results as internal artifacts.',
  provider_compute: 'Execute capability-gated provider compute and retain results as internal artifacts.',
});

const baseProviderCapabilities = Object.freeze(['artifact_root_sync', 'external_handoff_state']);

const normalizeCapabilityList = (values) => [...new Set((Array.isArray(values) ? values : [])
  .map((value) => String(value || '').trim())
  .filter((value) => value && Object.prototype.hasOwnProperty.call(providerCapabilityCatalog, value)))]
  .sort();

const providerIdentityFromFlags = (flags, existing = null) => {
  const explicit = flags.provider ?? process.env.AIOS_PROVIDER_ID;
  const fallback = existing?.providerId || 'local-aios-cli';
  return {
    providerId: normalizeScopeToken(explicit, fallback, 'provider'),
    explicit: explicit !== undefined && explicit !== null,
  };
};

const externalHandoffForProvider = ({ flags, artifactRoot, operatorRequest, descriptor, existing = null }) => {
  const uri = typeof flags['handoff-uri'] === 'string'
    ? flags['handoff-uri'].trim()
    : typeof process.env.AIOS_HANDOFF_URI === 'string'
      ? process.env.AIOS_HANDOFF_URI.trim()
      : existing?.externalHandoff?.uri || null;
  const enabled = Boolean(uri);
  const state = enabled
    ? command === 'claim'
      ? 'completion_claim_ready_for_external_provider'
      : command === 'approve'
        ? 'operator_decision_ready_for_external_provider'
        : 'operator_state_ready_for_external_provider'
    : 'local_only';
  return {
    contract: 'aios.external_handoff_state.v0',
    enabled,
    state,
    uri,
    command,
    artifactRoot,
    requestId: operatorRequest.requestId,
    service: descriptor?.moduleId || null,
    updatedAt: new Date().toISOString(),
  };
};

const shapeProviderContract = ({ artifactRoot, operatorRequest, flags, descriptor, mode, existing = null }) => {
  const identity = providerIdentityFromFlags(flags, existing);
  if (existing?.providerId && identity.explicit && existing.providerId !== identity.providerId) {
    fail(EXIT_CODES.invalidInput, 'aios_cli_provider_contract_mismatch', {
      artifactRoot,
      requestedProviderId: identity.providerId,
      existingProviderId: existing.providerId,
      path: providerContractPath(artifactRoot),
    });
  }
  const requiredCapabilities = normalizeCapabilityList(descriptor?.requiredCapabilities || []);
  const supportedCapabilities = normalizeCapabilityList([
    ...baseProviderCapabilities,
    ...(descriptor?.capabilities || []),
    ...(existing?.supportedCapabilities || []),
  ]);
  const missingCapabilities = requiredCapabilities.filter((capability) => !supportedCapabilities.includes(capability));
  if (missingCapabilities.length > 0) {
    fail(EXIT_CODES.runtimeBlocked, 'aios_cli_provider_capability_negotiation_failed', {
      artifactRoot,
      providerId: identity.providerId,
      command,
      requiredCapabilities,
      supportedCapabilities,
      missingCapabilities,
    });
  }
  const syncRevision = Number.isInteger(existing?.sync?.revision) ? existing.sync.revision + 1 : 1;
  const sync = {
    contract: 'aios.provider.sync_metadata.v0',
    mode,
    revision: syncRevision,
    previousContractHash: existing?.contractHash || null,
    artifactRootHash: sha256(artifactRoot),
    lastCommand: command,
    lastPacketType: descriptor?.packetType || null,
    lastRequestId: operatorRequest.requestId,
    lastOperatorScopeHash: operatorRequest.operatorScope.scopeHash,
    syncedAt: new Date().toISOString(),
  };
  const contract = {
    ok: true,
    contract: 'aios.service.provider_contract.v0',
    route: runRoute,
    artifactRoot,
    providerId: identity.providerId,
    serviceId: descriptor?.moduleId || null,
    tenantId: operatorRequest.operatorScope.tenantId,
    tenantHash: sha256(operatorRequest.operatorScope.tenantId),
    requiredCapabilities,
    supportedCapabilities,
    negotiatedCapabilities: requiredCapabilities,
    capabilityCatalog: Object.fromEntries(supportedCapabilities.map((capability) => [capability, providerCapabilityCatalog[capability]])),
    sync,
    externalHandoff: externalHandoffForProvider({ flags, artifactRoot, operatorRequest, descriptor, existing }),
  };
  return {
    ...contract,
    path: providerContractPath(artifactRoot),
    contractHash: sha256({
      contract: contract.contract,
      route: contract.route,
      artifactRoot,
      providerId: contract.providerId,
      serviceId: contract.serviceId,
      tenantHash: contract.tenantHash,
      requiredCapabilities,
      supportedCapabilities,
      sync,
      externalHandoff: contract.externalHandoff,
    }),
  };
};

const readExistingProviderContract = async (artifactRoot) => {
  const path = providerContractPath(artifactRoot);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return await readJsonFile(path);
  } catch (error) {
    fail(EXIT_CODES.runtimeBlocked, 'aios_cli_provider_contract_unreadable', {
      artifactRoot,
      path,
      message: error.message,
    });
  }
};

const ensureProviderContract = async ({ artifactRoot, operatorRequest, flags, descriptor, mode }) => {
  const existing = await readExistingProviderContract(artifactRoot);
  if (!existing && mode !== 'establish') {
    fail(EXIT_CODES.runtimeBlocked, 'aios_cli_provider_contract_missing', {
      artifactRoot,
      path: providerContractPath(artifactRoot),
      remediation: 'Run aios boot for this artifact root before using provider-scoped operator commands.',
    });
  }
  if (existing?.tenantHash && existing.tenantHash !== sha256(operatorRequest.operatorScope.tenantId)) {
    fail(EXIT_CODES.invalidInput, 'aios_cli_provider_contract_tenant_mismatch', {
      artifactRoot,
      path: providerContractPath(artifactRoot),
      requestedTenantHash: sha256(operatorRequest.operatorScope.tenantId),
      existingTenantHash: existing.tenantHash,
    });
  }
  const providerContract = shapeProviderContract({
    artifactRoot,
    operatorRequest,
    flags,
    descriptor,
    mode: existing ? 'refresh' : mode,
    existing,
  });
  await writeFile(providerContract.path, `${JSON.stringify(providerContract, null, 2)}\n`, 'utf8');
  return providerContract;
};

const lifecycleSettingsDefaults = Object.freeze({
  lifecycle: 'enabled',
  scheduler: 'immediate',
  approvals: 'required',
});

const lifecycleSettingsAllowedValues = Object.freeze({
  lifecycle: ['enabled', 'disabled'],
  scheduler: ['immediate', 'hold'],
  approvals: ['required', 'optional'],
});

const normalizeLifecycleSetting = (flags, name) => {
  const raw = flags[name] ?? lifecycleSettingsDefaults[name];
  const value = String(raw).trim().toLowerCase();
  const allowed = lifecycleSettingsAllowedValues[name];
  if (!allowed.includes(value)) {
    fail(2, 'aios_cli_lifecycle_setting_invalid', {
      setting: name,
      value,
      allowed,
    });
  }
  return value;
};

const nextActionForLifecycleSettings = (controls) => {
  if (controls.lifecycle === 'disabled') {
    return {
      state: 'lifecycle_disabled',
      command: ['aios', 'boot', '--artifact-root', '<artifact-root>', '--lifecycle', 'enabled'],
      reason: 'Lifecycle execution is disabled for this artifact root.',
    };
  }
  if (controls.scheduler === 'hold') {
    return {
      state: 'scheduler_hold',
      command: ['aios', 'boot', '--artifact-root', '<artifact-root>', '--scheduler', 'immediate'],
      reason: 'The scheduler is holding new process execution.',
    };
  }
  return {
    state: 'ready',
    command: ['aios', 'run', '<job.json>', '--artifact-root', '<artifact-root>'],
    reason: 'Lifecycle execution and immediate scheduling are enabled.',
  };
};

const shapeLifecycleSettings = ({ artifactRoot, operatorRequest, flags, source }) => {
  const controls = {
    lifecycle: normalizeLifecycleSetting(flags, 'lifecycle'),
    scheduler: normalizeLifecycleSetting(flags, 'scheduler'),
    approvals: normalizeLifecycleSetting(flags, 'approvals'),
  };
  const settings = {
    ok: true,
    contract: 'aios.operator.lifecycle_settings.v0',
    route: runRoute,
    artifactRoot,
    source,
    controls,
    nextAction: nextActionForLifecycleSettings(controls),
    updatedBy: {
      command,
      requestId: operatorRequest.requestId,
      operator: operatorRequest.operatorScope.operator,
      role: operatorRequest.operatorScope.role,
      tenantId: operatorRequest.operatorScope.tenantId,
    },
    updatedAt: new Date().toISOString(),
  };
  return {
    ...settings,
    settingsHash: sha256({
      contract: settings.contract,
      route: settings.route,
      artifactRoot,
      controls,
      updatedBy: settings.updatedBy,
      nextAction: settings.nextAction,
    }),
  };
};

const validateLifecycleSettings = ({ settings, path, artifactRoot }) => {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    fail(1, 'aios_cli_lifecycle_settings_invalid', { path, artifactRoot, reason: 'settings_must_be_object' });
  }
  const controls = settings.controls;
  if (!controls || typeof controls !== 'object' || Array.isArray(controls)) {
    fail(1, 'aios_cli_lifecycle_settings_invalid', { path, artifactRoot, reason: 'controls_must_be_object' });
  }
  for (const [name, allowed] of Object.entries(lifecycleSettingsAllowedValues)) {
    if (!allowed.includes(controls[name])) {
      fail(1, 'aios_cli_lifecycle_settings_invalid', {
        path,
        artifactRoot,
        setting: name,
        value: controls[name] ?? null,
        allowed,
      });
    }
  }
  return {
    ...settings,
    path,
    nextAction: settings.nextAction || nextActionForLifecycleSettings(controls),
    readable: true,
  };
};

const readLifecycleSettings = async (artifactRoot, operatorRequest) => {
  const path = lifecycleSettingsPath(artifactRoot);
  if (!existsSync(path)) {
    return {
      ...shapeLifecycleSettings({
        artifactRoot,
        operatorRequest,
        flags: {},
        source: 'embedded_defaults_missing_settings_file',
      }),
      path,
      readable: false,
      missing: true,
    };
  }
  try {
    return validateLifecycleSettings({
      settings: await readJsonFile(path),
      path,
      artifactRoot,
    });
  } catch (error) {
    if (error instanceof AiosCliFailure) {
      throw error;
    }
    fail(1, 'aios_cli_lifecycle_settings_unreadable', { path, artifactRoot, message: error.message });
  }
};

const enforceLifecycleSettingsForRun = ({ lifecycleSettings, artifactRoot }) => {
  const { controls } = lifecycleSettings;
  if (controls.lifecycle === 'disabled') {
    fail(EXIT_CODES.runtimeBlocked, 'aios_cli_run_blocked_lifecycle_disabled', {
      artifactRoot,
      lifecycleSettings,
      nextAction: lifecycleSettings.nextAction,
    });
  }
  if (controls.scheduler === 'hold') {
    fail(EXIT_CODES.runtimeBlocked, 'aios_cli_run_blocked_scheduler_hold', {
      artifactRoot,
      lifecycleSettings,
      nextAction: lifecycleSettings.nextAction,
    });
  }
};

const shapeTenantBoundary = ({ artifactRoot, operatorRequest }) => {
  const boundary = {
    ok: true,
    contract: 'aios.tenant.boundary.v0',
    route: runRoute,
    artifactRoot,
    tenantId: operatorRequest.operatorScope.tenantId,
    tenantHash: sha256(operatorRequest.operatorScope.tenantId),
    establishedBy: {
      requestId: operatorRequest.requestId,
      operator: operatorRequest.operatorScope.operator,
      role: operatorRequest.operatorScope.role,
      operatorScopeHash: operatorRequest.operatorScope.scopeHash,
    },
    establishedAt: new Date().toISOString(),
    boundaryRule: 'Only CLI invocations with the same tenant id may read or mutate this artifact root.',
  };
  return {
    ...boundary,
    boundaryHash: sha256({
      contract: boundary.contract,
      route: boundary.route,
      artifactRoot,
      tenantId: boundary.tenantId,
      tenantHash: boundary.tenantHash,
      establishedBy: boundary.establishedBy,
      boundaryRule: boundary.boundaryRule,
    }),
  };
};

const assertTenantBoundaryMatches = ({ boundary, boundaryPath, artifactRoot, operatorRequest }) => {
  if (!boundary || typeof boundary !== 'object' || Array.isArray(boundary)) {
    fail(1, 'aios_cli_tenant_boundary_invalid', { artifactRoot, boundaryPath });
  }
  const requestedTenant = operatorRequest.operatorScope.tenantId;
  if (boundary.tenantId !== requestedTenant) {
    fail(2, 'aios_cli_tenant_boundary_mismatch', {
      artifactRoot,
      boundaryPath,
      requestedTenant,
      existingTenant: boundary.tenantId || null,
      existingTenantHash: boundary.tenantHash || null,
      requestScopeHash: operatorRequest.operatorScope.scopeHash,
    });
  }
  return {
    path: boundaryPath,
    status: 'matched',
    tenantId: boundary.tenantId,
    tenantHash: boundary.tenantHash || sha256(boundary.tenantId),
    boundaryHash: boundary.boundaryHash || sha256(boundary),
    establishedBy: boundary.establishedBy || null,
  };
};

const ensureTenantBoundary = async ({ artifactRoot, operatorRequest, mode }) => {
  const boundaryPath = tenantBoundaryPath(artifactRoot);
  if (existsSync(boundaryPath)) {
    let boundary;
    try {
      boundary = await readJsonFile(boundaryPath);
    } catch (error) {
      fail(1, 'aios_cli_tenant_boundary_unreadable', {
        artifactRoot,
        boundaryPath,
        message: error.message,
      });
    }
    return assertTenantBoundaryMatches({ boundary, boundaryPath, artifactRoot, operatorRequest });
  }
  if (mode !== 'establish') {
    fail(1, 'aios_cli_tenant_boundary_missing', {
      artifactRoot,
      boundaryPath,
      requestedTenant: operatorRequest.operatorScope.tenantId,
      remediation: 'Run aios boot for this artifact root and tenant before using operator commands.',
    });
  }
  const boundary = shapeTenantBoundary({ artifactRoot, operatorRequest });
  await writeFile(boundaryPath, `${JSON.stringify(boundary, null, 2)}\n`, 'utf8');
  return {
    path: boundaryPath,
    status: 'established',
    tenantId: boundary.tenantId,
    tenantHash: boundary.tenantHash,
    boundaryHash: boundary.boundaryHash,
    establishedBy: boundary.establishedBy,
  };
};

const initializeArtifactRoot = async (artifactRoot, tenantBoundary, lifecycleSettings, providerContract) => {
  const bootDir = join(artifactRoot, 'boot');
  const packetsDir = join(artifactRoot, 'packets');
  await mkdir(bootDir, { recursive: true });
  await mkdir(packetsDir, { recursive: true });
  const manifestPath = join(artifactRoot, 'aios-artifact-root.json');
  const manifest = {
    artifactRoot,
    initializedBy: 'aios-cli boot',
    layoutVersion: 1,
    tenantBoundary,
    lifecycleSettings: {
      path: lifecycleSettings.path,
      hash: lifecycleSettings.settingsHash,
      controls: lifecycleSettings.controls,
      nextAction: lifecycleSettings.nextAction,
    },
    providerContract: {
      path: providerContract.path,
      hash: providerContract.contractHash,
      providerId: providerContract.providerId,
      serviceId: providerContract.serviceId,
      negotiatedCapabilities: providerContract.negotiatedCapabilities,
      externalHandoffState: providerContract.externalHandoff.state,
    },
    directories: {
      boot: bootDir,
      packets: packetsDir,
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { bootDir, packetsDir, manifestPath, manifestHash: sha256(manifest) };
};

const invokeHostedBootSequence = async ({ artifactRoot, contractsInfo, flags }) => {
  if (flags['hosted-boot-module'] || process.env.AIOS_HOSTED_BOOT_MODULE) {
    const modulePath = resolve(process.cwd(), flags['hosted-boot-module'] || process.env.AIOS_HOSTED_BOOT_MODULE);
    const hosted = await import(pathToFileURL(modulePath).href);
    if (typeof hosted.boot !== 'function') {
      fail(1, 'aios_cli_hosted_boot_missing_export', { modulePath, export: 'boot' });
    }
    const result = await hosted.boot({ artifactRoot, kernelContracts: contractsInfo.contracts });
    return {
      mode: 'external_module',
      modulePath,
      result,
      resultHash: sha256(result ?? null),
    };
  }
  const phases = contractsInfo.contracts.requiredPhases || defaultKernelContracts().requiredPhases;
  return {
    mode: 'hosted_in_process',
    status: 'boot_sequence_complete',
    phases: phases.map((phase, index) => ({
      phase,
      ordinal: index + 1,
      ok: true,
    })),
    resultHash: sha256({ artifactRoot, contractHash: contractsInfo.contractHash, phases }),
  };
};

const boot = async (operatorRequest) => {
  const flags = parseFlags(process.argv.slice(3));
  const descriptor = operatorUserlandModules.boot;
  const artifactRoot = resolveInsideWorkspace(flags['artifact-root'], '--artifact-root');
  await mkdir(artifactRoot, { recursive: true });
  const tenantBoundary = await ensureTenantBoundary({ artifactRoot, operatorRequest, mode: 'establish' });
  const lifecycleSettings = {
    ...shapeLifecycleSettings({
      artifactRoot,
      operatorRequest,
      flags,
      source: 'aios_cli_boot_flags',
    }),
    path: lifecycleSettingsPath(artifactRoot),
    readable: true,
    missing: false,
  };
  await writeFile(lifecycleSettings.path, `${JSON.stringify(lifecycleSettings, null, 2)}\n`, 'utf8');
  const providerContract = await ensureProviderContract({
    artifactRoot,
    operatorRequest,
    flags,
    descriptor,
    mode: 'establish',
  });
  const requestState = withOperatorRequestState(operatorRequest, {
    artifactRoot,
    tenantBoundary,
    inputs: {
      artifactRoot,
      tenantId: operatorRequest.operatorScope.tenantId,
      kernelContracts: flags['kernel-contracts'] || process.env.AIOS_KERNEL_CONTRACTS || null,
      hostedBootModule: flags['hosted-boot-module'] || process.env.AIOS_HOSTED_BOOT_MODULE || null,
      lifecycleSettings: lifecycleSettings.controls,
      providerContract: {
        path: providerContract.path,
        hash: providerContract.contractHash,
        providerId: providerContract.providerId,
        negotiatedCapabilities: providerContract.negotiatedCapabilities,
        externalHandoff: providerContract.externalHandoff.state,
      },
    },
  });
  const contractsInfo = await loadKernelContracts(flags);
  const artifactLayout = await initializeArtifactRoot(artifactRoot, tenantBoundary, lifecycleSettings, providerContract);
  const hostedBoot = await invokeHostedBootSequence({ artifactRoot, contractsInfo, flags });
  const outputRequestState = withOperatorRequestState(requestState, {
    outputs: {
      bootProofPacket: join(artifactLayout.packetsDir, 'boot-proof.packet.json'),
      manifestPath: artifactLayout.manifestPath,
      lifecycleSettingsPath: lifecycleSettings.path,
      providerContractPath: providerContract.path,
      lifecycleNextAction: lifecycleSettings.nextAction.state,
      providerSyncRevision: providerContract.sync.revision,
    },
  });
  const proofPacket = {
    ok: true,
    command: 'boot',
    packetType: 'aios.boot.proof',
    operatorUserlandModule: 'aios.operator.userland.boot.v0',
    route: 'L24_nexus+L27_forge+L20_simulator+L7_librarian_context_governor',
    operatorRequest: outputRequestState,
    generatedAt: new Date().toISOString(),
    artifactRoot,
    tenantBoundary,
    lifecycleSettings,
    providerContract,
    kernelContracts: {
      source: contractsInfo.source,
      loaded: contractsInfo.loaded,
      embeddedFallback: contractsInfo.embeddedFallback === true,
      hash: contractsInfo.contractHash,
      attempts: contractsInfo.attempts,
    },
    artifactLayout,
    hostedBoot,
  };
  proofPacket.proofHash = sha256({
    route: proofPacket.route,
    operatorRequest: outputRequestState,
    artifactRoot,
    tenantBoundary,
    lifecycleSettings,
    providerContract,
    kernelContracts: proofPacket.kernelContracts,
    artifactLayout,
    hostedBoot,
  });
  const proofPath = join(artifactLayout.packetsDir, 'boot-proof.packet.json');
  await writeFile(proofPath, `${JSON.stringify(proofPacket, null, 2)}\n`, 'utf8');
  printJson({ ...proofPacket, proofPath });
};

const run = async (operatorRequest) => {
  const { positional: jobInput, flags } = parsePositionalCommand(process.argv.slice(3), 'job');
  const descriptor = operatorUserlandModules.run;
  const jobPath = resolveInsideWorkspace(jobInput, 'job');
  const artifactRoot = resolveInsideWorkspace(flags['artifact-root'], '--artifact-root');
  const tenantBoundary = await ensureTenantBoundary({ artifactRoot, operatorRequest, mode: 'require' });
  const lifecycleSettings = await readLifecycleSettings(artifactRoot, operatorRequest);
  enforceLifecycleSettingsForRun({ lifecycleSettings, artifactRoot });
  const providerContract = await ensureProviderContract({
    artifactRoot,
    operatorRequest,
    flags,
    descriptor,
    mode: 'require',
  });
  const providerPolicyState = await loadProviderPolicy(flags);
  const requestState = withOperatorRequestState(operatorRequest, {
    artifactRoot,
    tenantBoundary,
    inputs: {
      artifactRoot,
      jobPath,
      tenantId: operatorRequest.operatorScope.tenantId,
      lifecycleSettings: lifecycleSettings.controls,
      providerContract: {
        path: providerContract.path,
        hash: providerContract.contractHash,
        providerId: providerContract.providerId,
        negotiatedCapabilities: providerContract.negotiatedCapabilities,
        externalHandoff: providerContract.externalHandoff.state,
      },
      providerPolicy: {
        path: providerPolicyState.path,
        digest: providerPolicyState.digest,
        mode: providerPolicyState.policy.mode,
        outputBoundary: providerPolicyState.policy.outputBoundary,
      },
    },
  });
  let job;
  try {
    job = await readJsonFile(jobPath);
  } catch (error) {
    fail(1, 'aios_cli_run_job_invalid_json', { jobPath, message: error.message });
  }

  const jobMeta = validateJobDocument(job, jobPath);
  const providerAccess = job.providerAccess ?? { grants: [] };
  if ((providerAccess.grants?.length ?? 0) > 0 && providerAccess.policyDigest !== providerPolicyState.digest) {
    fail(EXIT_CODES.runtimeBlocked, 'aios_cli_provider_policy_digest_mismatch', {
      jobPath,
      compiledPolicyDigest: providerAccess.policyDigest ?? null,
      activePolicyDigest: providerPolicyState.digest,
      policyPath: providerPolicyState.path,
    });
  }
  if ((providerAccess.grants?.length ?? 0) > 0 && (
    providerAccess.tenantId !== tenantBoundary.tenantId
    || providerAccess.tenantId !== job.boundary?.tenantId
    || providerAccess.workspaceId !== job.boundary?.workspaceId
  )) {
    fail(EXIT_CODES.runtimeBlocked, 'aios_cli_provider_scope_mismatch', {
      jobPath,
      tenantBoundary: tenantBoundary.tenantId,
      jobTenant: job.boundary?.tenantId ?? null,
      jobWorkspace: job.boundary?.workspaceId ?? null,
      grantTenant: providerAccess.tenantId ?? null,
      grantWorkspace: providerAccess.workspaceId ?? null,
    });
  }
  const processId = `aiosproc_${sha256({ jobPath, jobHash: jobMeta.hash }).slice(0, 16)}`;
  const processRequestState = withOperatorRequestState(requestState, {
    outputs: { processId },
  });
  const packetsDir = join(artifactRoot, 'packets');
  const runDir = join(artifactRoot, 'run');
  const processesDir = join(artifactRoot, 'processes');
  await mkdir(packetsDir, { recursive: true });
  await mkdir(runDir, { recursive: true });
  await mkdir(processesDir, { recursive: true });

  const processPath = join(processesDir, `${processId}.json`);
  const recovered = await readReusableProcessRecord({ processPath, processId, jobMeta });
  if (recovered.reusable) {
    if ((providerAccess.grants?.length ?? 0) > 0 && recovered.record?.providerPolicy?.digest !== providerPolicyState.digest) {
      fail(EXIT_CODES.runtimeBlocked, 'aios_cli_provider_policy_recovery_mismatch', {
        processId,
        processPath,
        recordedPolicyDigest: recovered.record?.providerPolicy?.digest ?? null,
        activePolicyDigest: providerPolicyState.digest,
      });
    }
    const recoveredRequestState = withOperatorRequestState(processRequestState, {
      outputs: {
        processId,
        recoveredProcessRecord: processPath,
        restartSafeStatus: recovered.reason,
      },
    });
    const processRecord = recovered.record;
    const processIndex = await writeProcessIndex({
      artifactRoot,
      processesDir,
      processRecord,
      processPath,
    });
    const lifecycle = Array.isArray(processRecord.lifecycle) ? processRecord.lifecycle : [];
    const syscallResults = Array.isArray(processRecord.syscallResults) ? processRecord.syscallResults : [];
    const runProof = buildRunProofPacket({
      operatorRequest: recoveredRequestState,
      artifactRoot,
      processRecord,
      processPath,
      processIndex,
      job: processRecord.job,
      syscallResults,
      lifecycle,
      lifecycleSettings: processRecord.lifecycleSettings || lifecycleSettings,
      providerContract,
      providerPolicyState: processRecord.providerPolicy || {
        path: providerPolicyState.path,
        digest: providerPolicyState.digest,
        mode: providerPolicyState.policy.mode,
        outputBoundary: providerPolicyState.policy.outputBoundary,
        externalWrites: false,
      },
      restartSafety: {
        idempotent: true,
        recovered: true,
        status: 'completed_record_reused',
        reason: recovered.reason,
        existingRecordHash: recovered.recordHash,
        lifecycleCount: recovered.lifecycleCount,
        syscallCount: recovered.syscallCount,
        firstLifecycleAt: recovered.firstLifecycleAt,
        lastLifecycleAt: recovered.lastLifecycleAt,
        indexRepair: {
          attempted: true,
          indexPath: processIndex.path,
          indexHash: processIndex.hash,
        },
      },
    });
    const proofPath = join(packetsDir, 'run-proof.packet.json');
    await writeFile(proofPath, `${JSON.stringify(runProof, null, 2)}\n`, 'utf8');
    printJson({ ...runProof, proofPath });
    return;
  }
  if (recovered.reason !== 'process_record_missing') {
    fail(1, 'aios_cli_run_blocked_existing_process_not_reusable', {
      processId,
      jobPath,
      artifactRoot,
      recovery: recovered,
      restartSafeStatus: 'manual_recovery_required',
    });
  }

  const lifecycle = [];
  appendLifecycle(lifecycle, 'admitted', {
    processId,
    jobId: jobMeta.id,
    jobHash: jobMeta.hash,
    requestId: processRequestState.requestId,
    admission: 'aios.kernel.process_table.v0',
  });
  appendLifecycle(lifecycle, 'scheduled', {
    processId,
    scheduler: 'aios.kernel.scheduler.v0',
  });

  const jobSyscalls = extractJobSyscalls(job, jobMeta);
  const syscallRequests = [
    {
      ordinal: 0,
      op: 'process.admit',
      args: { processId, jobId: jobMeta.id, jobHash: jobMeta.hash },
    },
    ...jobSyscalls,
    {
      ordinal: jobSyscalls.length + 1,
      op: 'kernel.complete',
      args: { status: 'completed', processId },
    },
  ].map((request, index) => ({ ...request, ordinal: index + 1 }));

  appendLifecycle(lifecycle, 'running', {
    processId,
    syscallCount: syscallRequests.length,
  });
  const syscallResults = await executeKernelSyscalls({
    artifactRoot,
    processId,
    jobMeta,
    syscallRequests,
    lifecycle,
    providerPolicy: providerPolicyState.policy,
    providerAccess,
  });
  appendLifecycle(lifecycle, 'completed', {
    processId,
    completedSyscalls: syscallResults.length,
  });

  const processRecord = {
    processId,
    job: {
      path: jobPath,
      id: jobMeta.id,
      title: jobMeta.title,
      hash: jobMeta.hash,
    },
    state: 'completed',
    route: runRoute,
    operatorRequest: processRequestState,
    admittedBy: 'aios-cli run',
    syscallMediator: 'aios.kernel.syscall.v0',
    lifecycleSettings,
    providerContract,
    providerPolicy: {
      path: providerPolicyState.path,
      digest: providerPolicyState.digest,
      mode: providerPolicyState.policy.mode,
      outputBoundary: providerPolicyState.policy.outputBoundary,
      externalWrites: false,
    },
    lifecycle,
    syscallResults,
  };
  processRecord.analytics = buildProcessAnalytics({
    processId,
    state: processRecord.state,
    job: processRecord.job,
    lifecycle,
    syscallResults,
    recordPath: processPath,
  });
  processRecord.recordHash = sha256({
    processId,
    job: processRecord.job,
    state: processRecord.state,
    route: processRecord.route,
    operatorRequest: processRequestState,
    lifecycleSettings,
    providerContract,
    providerPolicy: processRecord.providerPolicy,
    lifecycle,
    syscallResults,
  });

  await writeFile(processPath, `${JSON.stringify(processRecord, null, 2)}\n`, 'utf8');
  const processIndex = await writeProcessIndex({
    artifactRoot,
    processesDir,
    processRecord,
    processPath,
  });

  const runProof = buildRunProofPacket({
    operatorRequest: processRequestState,
    artifactRoot,
    processRecord,
    processPath,
    processIndex,
    job: processRecord.job,
    syscallResults,
    lifecycle,
    lifecycleSettings,
    providerContract,
    providerPolicyState: processRecord.providerPolicy,
    restartSafety: {
      idempotent: true,
      recovered: false,
      status: 'new_process_record_written',
      recoveryProbe: recovered.reason,
      indexRepair: {
        attempted: true,
        indexPath: processIndex.path,
        indexHash: processIndex.hash,
      },
    },
  });

  const proofPath = join(packetsDir, 'run-proof.packet.json');
  await writeFile(proofPath, `${JSON.stringify(runProof, null, 2)}\n`, 'utf8');
  printJson({ ...runProof, proofPath });
};

const claim = async (operatorRequest) => {
  const { positional: jobInput, flags } = parsePositionalCommand(process.argv.slice(3), 'job');
  const descriptor = operatorUserlandModules.claim;
  const jobPath = resolveInsideWorkspace(jobInput, 'job');
  const artifactRoot = resolveInsideWorkspace(flags['artifact-root'], '--artifact-root');
  const tenantBoundary = await ensureTenantBoundary({ artifactRoot, operatorRequest, mode: 'require' });
  const lifecycleSettings = await readLifecycleSettings(artifactRoot, operatorRequest);
  const providerContract = await ensureProviderContract({
    artifactRoot,
    operatorRequest,
    flags,
    descriptor,
    mode: 'require',
  });
  const requestState = withOperatorRequestState(operatorRequest, {
    artifactRoot,
    tenantBoundary,
    inputs: {
      artifactRoot,
      jobPath,
      tenantId: operatorRequest.operatorScope.tenantId,
      lifecycleSettings: lifecycleSettings.controls,
      providerContract: {
        path: providerContract.path,
        hash: providerContract.contractHash,
        providerId: providerContract.providerId,
        negotiatedCapabilities: providerContract.negotiatedCapabilities,
        externalHandoff: providerContract.externalHandoff.state,
      },
    },
  });
  let job;
  try {
    job = await readJsonFile(jobPath);
  } catch (error) {
    fail(1, 'aios_cli_claim_job_invalid_json', { jobPath, message: error.message });
  }

  const bootProof = await readExistingJsonCandidate(artifactRoot, [
    'packets/boot-proof.packet.json',
    'boot/boot-proof.packet.json',
    'boot-proof.packet.json',
    'aios-boot-proof.json',
  ], 'boot_proof');
  const runProof = await readExistingJsonCandidate(artifactRoot, [
    'packets/run-proof.packet.json',
    'run/run-proof.packet.json',
    'run-proof.packet.json',
    'aios-run-proof.json',
  ], 'run_proof');
  const verifierEvidence = await readExistingJsonCandidate(artifactRoot, [
    'packets/verifier-evidence.packet.json',
    'packets/verification-evidence.packet.json',
    'packets/verifier-result.packet.json',
    'verifier/evidence.json',
    'verification/evidence.json',
    'verifier-result.json',
  ], 'verifier_evidence');

  requireGreenArtifact(bootProof, 'boot_proof');
  requireGreenArtifact(runProof, 'run_proof');
  requireVerifierEvidence(verifierEvidence);

  const packetType = 'aios.completion.claim';
  const route = 'L24_nexus+L27_forge+L20_simulator+L7_librarian_context_governor';
  const claimSubject = `claim:${sha256({ jobPath, jobHash: sha256(job), artifactRoot }).slice(0, 16)}`;
  const outputRequestState = withOperatorRequestState(requestState, {
    outputs: {
      claimSubject,
      requiredArtifactHashes: {
        bootProof: bootProof.hash,
        runProof: runProof.hash,
        verifierEvidence: verifierEvidence.hash,
      },
      approvalRequirement: lifecycleSettings.controls.approvals,
      lifecycleNextAction: lifecycleSettings.nextAction.state,
      providerSyncRevision: providerContract.sync.revision,
    },
  });
  const claimPacket = {
    ok: true,
    command: 'claim',
    packetType,
    operatorUserlandModule: 'aios.operator.userland.claim.v0',
    route,
    operatorRequest: outputRequestState,
    generatedAt: new Date().toISOString(),
    subject: claimSubject,
    job: {
      path: jobPath,
      hash: sha256(job),
      id: job.id || job.jobId || job.name || null,
    },
    artifactRoot,
    tenantBoundary,
    lifecycleSettings,
    providerContract,
    requiredArtifacts: {
      bootProof: {
        path: bootProof.path,
        hash: bootProof.hash,
        green: true,
      },
      runProof: {
        path: runProof.path,
        hash: runProof.hash,
        green: true,
      },
      verifierEvidence: {
        path: verifierEvidence.path,
        hash: verifierEvidence.hash,
        green: true,
      },
    },
    claimStatus: 'allowed',
    approvalRequirement: lifecycleSettings.controls.approvals,
    nextAction: lifecycleSettings.controls.approvals === 'required'
      ? {
        state: 'awaiting_operator_approval',
        command: ['aios', 'approve', '--artifact-root', artifactRoot, '--subject', claimSubject],
      }
      : {
        state: 'approval_optional',
        command: ['aios', 'ps', '--artifact-root', artifactRoot],
      },
    truthBoundary: 'Completion claims require green boot proof, green run proof, and green verifier evidence under the artifact root.',
  };
  claimPacket.claimHash = sha256({
    packetType,
    route,
    operatorRequest: outputRequestState,
    job: claimPacket.job,
    artifactRoot,
    tenantBoundary,
    lifecycleSettings,
    providerContract,
    requiredArtifacts: claimPacket.requiredArtifacts,
    claimStatus: claimPacket.claimStatus,
    approvalRequirement: claimPacket.approvalRequirement,
  });

  const packetsDir = join(artifactRoot, 'packets');
  await mkdir(packetsDir, { recursive: true });
  const claimPath = join(packetsDir, 'completion-claim.packet.json');
  await writeFile(claimPath, `${JSON.stringify(claimPacket, null, 2)}\n`, 'utf8');
  printJson({ ...claimPacket, claimPath });
};

const readProcessRecords = async (artifactRoot) => {
  const processesDir = join(artifactRoot, 'processes');
  const processIndex = await readProcessIndex(artifactRoot);
  if (!existsSync(processesDir)) {
    return {
      processesDir,
      processIndex,
      reconciliation: {
        indexedCount: processIndex.entries.length,
        recordCount: 0,
        missingRecordIds: processIndex.entries.map((entry) => entry.processId).filter(Boolean),
        unindexedRecordIds: [],
        hashMismatches: [],
        consistent: processIndex.entries.length === 0,
      },
      records: [],
    };
  }
  const entries = await readdir(processesDir, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name === 'process-index.json') {
      continue;
    }
    const path = join(processesDir, entry.name);
    const payload = await tryReadJsonFile(path);
    records.push({
      path,
      readable: !payload.__aiosReadError,
      payload,
    });
  }
  records.sort((left, right) => String(left.payload?.processId || left.path).localeCompare(String(right.payload?.processId || right.path)));
  const recordsById = new Map(records
    .filter((record) => typeof record.payload?.processId === 'string')
    .map((record) => [record.payload.processId, record]));
  const indexById = new Map(processIndex.entries
    .filter((entry) => typeof entry.processId === 'string')
    .map((entry) => [entry.processId, entry]));
  const reconciliation = {
    indexedCount: processIndex.entries.length,
    recordCount: records.length,
    missingRecordIds: processIndex.entries
      .filter((entry) => !recordsById.has(entry.processId))
      .map((entry) => entry.processId),
    unindexedRecordIds: records
      .filter((record) => record.payload?.processId && !indexById.has(record.payload.processId))
      .map((record) => record.payload.processId),
    hashMismatches: records
      .filter((record) => {
        const indexed = indexById.get(record.payload?.processId);
        return indexed?.recordHash && record.payload?.recordHash && indexed.recordHash !== record.payload.recordHash;
      })
      .map((record) => ({
        processId: record.payload.processId,
        indexedHash: indexById.get(record.payload.processId).recordHash,
        recordHash: record.payload.recordHash,
      })),
  };
  reconciliation.consistent = reconciliation.missingRecordIds.length === 0
    && reconciliation.unindexedRecordIds.length === 0
    && reconciliation.hashMismatches.length === 0;
  return { processesDir, processIndex, reconciliation, records };
};

const backoffPlanForHealthIssueCount = (issueCount) => {
  const firstDelayMs = Math.min(5000, 250 * Math.max(1, issueCount));
  return {
    contract: 'aios.operator.retry_backoff.v0',
    retryable: issueCount > 0,
    maxAttempts: issueCount > 0 ? 3 : 0,
    firstDelayMs,
    multiplier: 2,
    maxDelayMs: 10000,
    jitter: 'request_id_hash',
  };
};

const createHealthIssue = ({ code, severity = 'warning', component, message, evidence = {}, remediation = [] }) => ({
  code,
  severity,
  component,
  message,
  evidence,
  remediation,
});

const evaluateProcessTableHealth = ({ artifactRoot, processesDir, processIndex, reconciliation, records }) => {
  const issues = [];
  if (!processIndex.readable) {
    issues.push(createHealthIssue({
      code: 'process_index_unreadable',
      severity: 'error',
      component: 'process-index',
      message: 'The process index could not be read as JSON.',
      evidence: { path: processIndex.path, error: processIndex.error || null },
      remediation: ['Run aios run for the affected job to rebuild the process index.', 'Inspect or replace the process-index.json artifact.'],
    }));
  }
  for (const processId of reconciliation.missingRecordIds) {
    issues.push(createHealthIssue({
      code: 'indexed_process_record_missing',
      severity: 'error',
      component: 'process-record',
      message: 'The process index references a process record that is not present on disk.',
      evidence: { processId, indexPath: processIndex.path },
      remediation: ['Re-run aios run for the original job if the record should exist.', 'Remove stale index entries by regenerating the index from valid process records.'],
    }));
  }
  for (const processId of reconciliation.unindexedRecordIds) {
    issues.push(createHealthIssue({
      code: 'process_record_unindexed',
      severity: 'warning',
      component: 'process-index',
      message: 'A process record exists but is missing from the process index.',
      evidence: { processId, processesDir },
      remediation: ['Run aios run for the matching job to repair the process index.', 'Use the record path from ps output when reading logs directly.'],
    }));
  }
  for (const mismatch of reconciliation.hashMismatches) {
    issues.push(createHealthIssue({
      code: 'process_record_hash_mismatch',
      severity: 'error',
      component: 'process-record',
      message: 'The process index hash does not match the process record hash.',
      evidence: mismatch,
      remediation: ['Inspect the process record for partial writes or manual edits.', 'Re-run the job to produce a fresh process record and index entry.'],
    }));
  }
  for (const record of records.filter((candidate) => !candidate.readable)) {
    issues.push(createHealthIssue({
      code: 'process_record_unreadable',
      severity: 'error',
      component: 'process-record',
      message: 'A process record file could not be read as JSON.',
      evidence: { path: record.path, error: record.payload?.__aiosReadError || null },
      remediation: ['Fix or remove the unreadable process record.', 'Re-run the job to write a replacement record.'],
    }));
  }
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const mode = errorCount > 0 ? 'degraded' : warningCount > 0 ? 'degraded_readable' : 'healthy';
  return {
    contract: 'aios.operator.health.v0',
    artifactRoot,
    checkedAt: new Date().toISOString(),
    mode,
    ok: errorCount === 0,
    degraded: issues.length > 0,
    summary: {
      errorCount,
      warningCount,
      issueCount: issues.length,
      indexedCount: reconciliation.indexedCount,
      recordCount: reconciliation.recordCount,
      reconciliationConsistent: reconciliation.consistent,
    },
    issues,
    failureState: issues.length > 0
      ? {
        state: errorCount > 0 ? 'operator_attention_required' : 'index_repair_recommended',
        strictExitCode: EXIT_CODES.runtimeBlocked,
        actionable: true,
      }
      : {
        state: 'none',
        strictExitCode: EXIT_CODES.success,
        actionable: false,
      },
    retryBackoff: backoffPlanForHealthIssueCount(issues.length),
  };
};

const ps = async (operatorRequest) => {
  const flags = parseFlags(process.argv.slice(3));
  const descriptor = operatorUserlandModules.ps;
  const artifactRoot = resolveInsideWorkspace(flags['artifact-root'], '--artifact-root');
  const stateFilter = typeof flags.state === 'string' ? flags.state : null;
  const strictHealth = flags['strict-health'] === true || flags['strict-health'] === 'true';
  const tenantBoundary = await ensureTenantBoundary({ artifactRoot, operatorRequest, mode: 'require' });
  const lifecycleSettings = await readLifecycleSettings(artifactRoot, operatorRequest);
  const providerContract = await ensureProviderContract({
    artifactRoot,
    operatorRequest,
    flags,
    descriptor,
    mode: 'require',
  });
  const requestState = withOperatorRequestState(operatorRequest, {
    artifactRoot,
    tenantBoundary,
    inputs: {
      artifactRoot,
      tenantId: operatorRequest.operatorScope.tenantId,
      state: stateFilter,
      strictHealth,
      lifecycleSettings: lifecycleSettings.controls,
      providerContract: {
        path: providerContract.path,
        hash: providerContract.contractHash,
        providerId: providerContract.providerId,
        negotiatedCapabilities: providerContract.negotiatedCapabilities,
        externalHandoff: providerContract.externalHandoff.state,
      },
    },
  });
  const { processesDir, processIndex, reconciliation, records } = await readProcessRecords(artifactRoot);
  const analytics = buildFleetAnalytics({ records, processIndex, reconciliation });
  const health = evaluateProcessTableHealth({
    artifactRoot,
    processesDir,
    processIndex,
    reconciliation,
    records,
  });
  const indexById = new Map(processIndex.entries
    .filter((entry) => typeof entry.processId === 'string')
    .map((entry) => [entry.processId, entry]));
  const processes = records
    .filter((record) => !stateFilter || record.payload?.state === stateFilter)
    .map((record) => {
      const indexed = indexById.get(record.payload?.processId);
      const processAnalytics = record.readable ? buildProcessAnalytics({
        processId: record.payload?.processId || null,
        state: record.payload?.state || 'unknown',
        job: record.payload?.job || null,
        lifecycle: record.payload?.lifecycle,
        syscallResults: record.payload?.syscallResults,
        recordPath: record.path,
      }) : null;
      return {
        processId: record.payload?.processId || null,
        state: record.payload?.state || 'unknown',
        jobId: record.payload?.job?.id || indexed?.jobId || null,
        admittedBy: record.payload?.admittedBy || null,
        route: record.payload?.route || indexed?.route || null,
        requestId: record.payload?.operatorRequest?.requestId || indexed?.requestId || null,
        operatorUserlandModule: record.payload?.operatorRequest?.operatorUserlandModule || indexed?.operatorUserlandModule || null,
        handoff: record.payload?.operatorRequest?.handoff || null,
        lifecycleCount: Array.isArray(record.payload?.lifecycle) ? record.payload.lifecycle.length : 0,
        recordHash: record.payload?.recordHash || null,
        indexed: Boolean(indexed),
        indexRecordHash: indexed?.recordHash || null,
        path: record.path,
        readable: record.readable,
        analytics: processAnalytics ? {
          summary: processAnalytics.summary,
          counters: processAnalytics.counters,
          exportSummary: processAnalytics.exportSummary,
          historySnapshot: processAnalytics.historySnapshot,
        } : null,
        error: record.payload?.__aiosReadError,
      };
    });
  if (strictHealth && health.degraded) {
    fail(EXIT_CODES.runtimeBlocked, 'aios_cli_ps_health_degraded', {
      artifactRoot,
      processCount: processes.length,
      health,
      retryBackoff: health.retryBackoff,
      remediation: health.issues.flatMap((issue) => issue.remediation).slice(0, 6),
    });
  }
  printJson({
    ok: true,
    command: 'ps',
    packetType: 'aios.operator.ps',
    operatorUserlandModule: 'aios.operator.userland.ps.v0',
    route: runRoute,
    operatorRequest: withOperatorRequestState(requestState, {
      outputs: {
        processCount: processes.length,
        reconciliationConsistent: reconciliation.consistent,
        healthMode: health.mode,
        healthIssueCount: health.summary.issueCount,
        analyticsSnapshotHash: analytics.historySnapshot.snapshotHash,
        exportRowCount: analytics.exportSummary.rows.length,
        lifecycleNextAction: lifecycleSettings.nextAction.state,
        providerSyncRevision: providerContract.sync.revision,
      },
    }),
    artifactRoot,
    tenantBoundary,
    lifecycleSettings,
    providerContract,
    processesDir,
    processIndex,
    reconciliation,
    health,
    analytics,
    degradedMode: {
      active: health.degraded,
      strictHealth,
      behavior: health.degraded && !strictHealth
        ? 'returned_partial_operator_view_with_health_issues'
        : 'normal_operator_view',
    },
    stateFilter,
    count: processes.length,
    processes,
  });
};

const logs = async (operatorRequest) => {
  const flags = parseFlags(process.argv.slice(3));
  const descriptor = operatorUserlandModules.logs;
  const artifactRoot = resolveInsideWorkspace(flags['artifact-root'], '--artifact-root');
  const requestedProcess = typeof flags.process === 'string' ? flags.process : null;
  const tenantBoundary = await ensureTenantBoundary({ artifactRoot, operatorRequest, mode: 'require' });
  const lifecycleSettings = await readLifecycleSettings(artifactRoot, operatorRequest);
  const providerContract = await ensureProviderContract({
    artifactRoot,
    operatorRequest,
    flags,
    descriptor,
    mode: 'require',
  });
  const requestState = withOperatorRequestState(operatorRequest, {
    artifactRoot,
    tenantBoundary,
    inputs: {
      artifactRoot,
      tenantId: operatorRequest.operatorScope.tenantId,
      processId: requestedProcess,
      lifecycleSettings: lifecycleSettings.controls,
      providerContract: {
        path: providerContract.path,
        hash: providerContract.contractHash,
        providerId: providerContract.providerId,
        negotiatedCapabilities: providerContract.negotiatedCapabilities,
        externalHandoff: providerContract.externalHandoff.state,
      },
    },
  });
  const { processIndex, reconciliation, records } = await readProcessRecords(artifactRoot);
  const matching = requestedProcess
    ? records.filter((record) => record.payload?.processId === requestedProcess)
    : records;
  if (requestedProcess && matching.length === 0) {
    fail(1, 'aios_cli_logs_process_not_found', { processId: requestedProcess, artifactRoot });
  }
  const analytics = buildFleetAnalytics({ records: matching, processIndex, reconciliation });
  const events = matching.flatMap((record) => {
    const lifecycle = Array.isArray(record.payload?.lifecycle) ? record.payload.lifecycle : [];
    return lifecycle.map((event) => ({
      processId: record.payload?.processId || null,
      requestId: record.payload?.operatorRequest?.requestId || null,
      source: record.path,
      ...event,
    }));
  }).sort((left, right) => String(left.at || '').localeCompare(String(right.at || '')) || Number(left.ordinal || 0) - Number(right.ordinal || 0));
  printJson({
    ok: true,
    command: 'logs',
    packetType: 'aios.operator.logs',
    operatorUserlandModule: 'aios.operator.userland.logs.v0',
    route: runRoute,
    operatorRequest: withOperatorRequestState(requestState, {
      outputs: {
        eventCount: events.length,
        processCount: matching.length,
        analyticsSnapshotHash: analytics.historySnapshot.snapshotHash,
        exportRowCount: analytics.exportSummary.rows.length,
        lifecycleNextAction: lifecycleSettings.nextAction.state,
        providerSyncRevision: providerContract.sync.revision,
      },
    }),
    artifactRoot,
    tenantBoundary,
    lifecycleSettings,
    providerContract,
    processId: requestedProcess,
    processIndex,
    reconciliation,
    analytics: {
      ...analytics,
      timeline: events.map((event, index) => {
        const previous = index > 0 ? events[index - 1] : null;
        return {
          ordinal: index + 1,
          processId: event.processId || null,
          requestId: event.requestId || null,
          state: event.state || 'unknown',
          at: event.at || null,
          deltaMsFromPrevious: previous ? millisecondsBetween(previous.at, event.at) : 0,
          source: event.source,
          syscall: event.syscall || null,
          resultHash: event.resultHash || null,
        };
      }),
      report: {
        contract: 'aios.operator.logs_report.v0',
        processFilter: requestedProcess,
        eventCount: events.length,
        firstEventAt: events[0]?.at || null,
        lastEventAt: events[events.length - 1]?.at || null,
        durationMs: millisecondsBetween(events[0]?.at, events[events.length - 1]?.at),
        eventStateCounts: countBy(events, (event) => event.state || 'unknown'),
      },
    },
    count: events.length,
    events,
  });
};

const approve = async (operatorRequest) => {
  const flags = parseFlags(process.argv.slice(3));
  const descriptor = operatorUserlandModules.approve;
  const artifactRoot = resolveInsideWorkspace(flags['artifact-root'], '--artifact-root');
  const tenantBoundary = await ensureTenantBoundary({ artifactRoot, operatorRequest, mode: 'require' });
  const providerContract = await ensureProviderContract({
    artifactRoot,
    operatorRequest,
    flags,
    descriptor,
    mode: 'require',
  });
  const subject = typeof flags.subject === 'string' && flags.subject.trim() ? flags.subject.trim() : null;
  if (!subject) {
    fail(2, 'aios_cli_approve_missing_subject', { usage: usage.approve });
  }
  const decision = typeof flags.decision === 'string' ? flags.decision.trim().toLowerCase() : 'approve';
  if (!['approve', 'reject'].includes(decision)) {
    fail(2, 'aios_cli_approve_invalid_decision', { decision, allowed: ['approve', 'reject'] });
  }
  const requestState = withOperatorRequestState(operatorRequest, {
    artifactRoot,
    tenantBoundary,
    inputs: {
      artifactRoot,
      tenantId: operatorRequest.operatorScope.tenantId,
      subject,
      decision,
      providerContract: {
        path: providerContract.path,
        hash: providerContract.contractHash,
        providerId: providerContract.providerId,
        negotiatedCapabilities: providerContract.negotiatedCapabilities,
        externalHandoff: providerContract.externalHandoff.state,
      },
    },
  });
  const approvalsDir = join(artifactRoot, 'approvals');
  const packetsDir = join(artifactRoot, 'packets');
  await mkdir(approvalsDir, { recursive: true });
  await mkdir(packetsDir, { recursive: true });
  const safeSubject = subject.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'subject';
  const approvalPath = join(approvalsDir, `${safeSubject}.approval.packet.json`);
  const latestPath = join(packetsDir, 'operator-approval.packet.json');
  const outputRequestState = withOperatorRequestState(requestState, {
    outputs: {
      approvalPath,
      latestPath,
      rejected: decision === 'reject',
      providerSyncRevision: providerContract.sync.revision,
    },
  });
  const approval = {
    ok: decision === 'approve',
    command: 'approve',
    packetType: 'aios.operator.approval',
    operatorUserlandModule: 'aios.operator.userland.approve.v0',
    route: runRoute,
    operatorRequest: outputRequestState,
    generatedAt: new Date().toISOString(),
    artifactRoot,
    tenantBoundary,
    providerContract,
    subject,
    decision,
    reason: typeof flags.reason === 'string' ? flags.reason : null,
    approver: typeof flags.approver === 'string' ? flags.approver : process.env.USER || 'operator',
  };
  approval.approvalHash = sha256({
    packetType: approval.packetType,
    route: approval.route,
    operatorRequest: outputRequestState,
    tenantBoundary,
    providerContract,
    subject,
    decision,
    reason: approval.reason,
    approver: approval.approver,
  });
  const serialized = `${JSON.stringify(approval, null, 2)}\n`;
  await writeFile(approvalPath, serialized, 'utf8');
  await writeFile(latestPath, serialized, 'utf8');
  printJson({ ...approval, approvalPath, latestPath });
  if (decision === 'reject') {
    fail(EXIT_CODES.operatorRejected, 'aios_cli_operator_rejected_subject', {
      subject,
      decision,
      approvalPath,
      latestPath,
    });
  }
};

const compile = async (operatorRequest) => {
  const { positional: sourceInput, flags } = parsePositionalCommand(process.argv.slice(3), 'source');
  const sourcePath = resolveInsideWorkspace(sourceInput, 'source');
  const artifactRoot = resolveInsideWorkspace(flags['artifact-root'], '--artifact-root');
  const workspaceId = normalizeScopeToken(flags.workspace, 'default', 'workspace');
  const providerPolicyState = await loadProviderPolicy(flags);
  const source = await readFile(sourcePath, 'utf8');
  await mkdir(artifactRoot, { recursive: true });
  await mkdir(join(artifactRoot, 'packets'), { recursive: true });

  const result = compileCanonicalAiosSource(source, {
    sourceName: basename(sourcePath),
    tenantId: operatorRequest.operatorScope.tenantId,
    workspaceId,
    actorId: operatorRequest.operatorScope.operator,
    role: operatorRequest.operatorScope.role,
    providerPolicy: providerPolicyState.policy,
  });
  const safeBase = basename(sourcePath).replace(/\.aios$/i, '').replace(/[^a-zA-Z0-9_.-]/g, '-') || 'program';
  const jobPaths = [];
  if (result.ok) {
    for (const [index, job] of result.jobs.entries()) {
      const suffix = result.jobs.length > 1 ? `-${index + 1}` : '';
      const jobPath = join(artifactRoot, `${safeBase}${suffix}.compiled.job.json`);
      await writeFile(jobPath, `${JSON.stringify(job, null, 2)}\n`, 'utf8');
      jobPaths.push(jobPath);
    }
  }
  const requestState = withOperatorRequestState(operatorRequest, {
    artifactRoot,
    inputs: {
      sourcePath,
      workspaceId,
      tenantId: operatorRequest.operatorScope.tenantId,
      providerPolicy: { path: providerPolicyState.path, digest: providerPolicyState.digest },
    },
    outputs: { jobPaths, compileState: result.status.state },
  });
  const packet = {
    ok: result.ok,
    command: 'compile',
    packetType: 'aios.language.compile.proof',
    operatorUserlandModule: 'aios.operator.userland.compile.v1',
    route: runRoute,
    operatorRequest: requestState,
    generatedAt: new Date().toISOString(),
    artifactRoot,
    sourcePath,
    jobPaths,
    language: result.language,
    boundary: result.boundary,
    status: result.status,
    diagnostics: result.diagnostics,
    compilerEvidence: result.compilerEvidence,
    providerPolicy: {
      path: providerPolicyState.path,
      digest: providerPolicyState.digest,
      mode: providerPolicyState.policy.mode,
      outputBoundary: providerPolicyState.policy.outputBoundary,
      externalWrites: false,
    },
  };
  packet.proofHash = sha256({
    packetType: packet.packetType,
    source: result.source,
    jobPaths,
    boundary: result.boundary,
    status: result.status,
    diagnostics: result.diagnostics,
    providerPolicy: packet.providerPolicy,
  });
  const proofPath = join(artifactRoot, 'packets', 'language-compile.packet.json');
  await writeFile(proofPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  if (!result.ok) {
    fail(EXIT_CODES.runtimeBlocked, 'aios_language_compile_blocked', {
      sourcePath,
      proofPath,
      status: result.status,
      diagnostics: result.diagnostics,
    });
  }
  printJson({ ...packet, proofPath });
};

const help = async (operatorRequest) => {
  printJson({
    ok: true,
    command,
    packetType: 'aios.operator.help',
    operatorUserlandModule: 'aios.operator.userland.help.v0',
    route: runRoute,
    operatorRequest: withOperatorRequestState(operatorRequest, {
      outputs: {
        commandCount: known.length,
      },
    }),
    commands: usage,
    exitCodes: exitCodeLabels,
    operatorUserland: operatorUserlandManifest(),
    providerContract: {
      contract: 'aios.service.provider_contract.v0',
      path: 'aios-provider-contract.json',
      identityFlag: '--provider',
      externalHandoffFlag: '--handoff-uri',
      baseCapabilities: baseProviderCapabilities,
      capabilityCatalog: providerCapabilityCatalog,
      establishedBy: ['boot'],
      refreshedBy: ['run', 'claim', 'ps', 'logs', 'approve'],
    },
    providerReadComputePolicy: {
      schemaVersion: 'aios.provider-read-compute-policy.v1',
      defaultPath: defaultProviderPolicyPath,
      operations: ['provider.read', 'provider.compute'],
      outputBoundary: 'internal-artifact-only',
      externalWrites: false,
    },
    lifecycleSettings: {
      contract: 'aios.operator.lifecycle_settings.v0',
      path: 'aios-lifecycle-settings.json',
      defaults: lifecycleSettingsDefaults,
      allowedValues: lifecycleSettingsAllowedValues,
      enforcedBy: ['run'],
      reportedBy: ['boot', 'ps', 'logs'],
    },
    truthBoundary: 'AI OS CLI compiles canonical .aios source and routes boot, run, claim, ps, logs, and approve through operator-userland handlers. Capability-gated provider reads/compute may emit internal artifacts; user-visible and external writes remain blocked.',
  });
};

const operatorUserlandModules = {
  help: {
    moduleId: 'aios.operator.userland.help.v0',
    handler: help,
    packetType: 'aios.operator.help',
    successExitCode: EXIT_CODES.success,
    failureExitCodes: [EXIT_CODES.invalidInput, EXIT_CODES.runtimeBlocked],
    allowedRoles: ['viewer', 'runner', 'approver', 'operator', 'admin'],
  },
  compile: {
    moduleId: 'aios.operator.userland.compile.v1',
    handler: compile,
    packetType: 'aios.language.compile.proof',
    successExitCode: EXIT_CODES.success,
    failureExitCodes: [EXIT_CODES.invalidInput, EXIT_CODES.runtimeBlocked],
    requiredPositionals: ['source'],
    requiredFlags: ['artifact-root'],
    optionalFlags: ['workspace', 'provider-policy'],
    allowedRoles: ['runner', 'operator', 'admin'],
    requiredCapabilities: ['artifact_root_sync', 'language_compile'],
    capabilities: ['language_compile'],
  },
  boot: {
    moduleId: 'aios.operator.userland.boot.v0',
    handler: boot,
    packetType: 'aios.boot.proof',
    successExitCode: EXIT_CODES.success,
    failureExitCodes: [EXIT_CODES.invalidInput, EXIT_CODES.runtimeBlocked],
    requiredFlags: ['artifact-root'],
    optionalFlags: ['provider', 'handoff-uri', 'kernel-contracts', 'hosted-boot-module', 'lifecycle', 'scheduler', 'approvals'],
    allowedRoles: ['operator', 'admin'],
    requiredCapabilities: ['artifact_root_sync', 'boot_proof_write'],
    capabilities: ['boot_proof_write'],
  },
  run: {
    moduleId: 'aios.operator.userland.run.v0',
    handler: run,
    packetType: runPacketType,
    successExitCode: EXIT_CODES.success,
    failureExitCodes: [EXIT_CODES.invalidInput, EXIT_CODES.runtimeBlocked],
    requiredPositionals: ['job'],
    requiredFlags: ['artifact-root'],
    optionalFlags: ['provider', 'handoff-uri', 'provider-policy'],
    allowedRoles: ['runner', 'operator', 'admin'],
    requiredCapabilities: ['artifact_root_sync', 'process_lifecycle_write'],
    capabilities: ['process_lifecycle_write', 'provider_read', 'provider_compute'],
  },
  claim: {
    moduleId: 'aios.operator.userland.claim.v0',
    handler: claim,
    packetType: 'aios.completion.claim',
    successExitCode: EXIT_CODES.success,
    failureExitCodes: [EXIT_CODES.invalidInput, EXIT_CODES.runtimeBlocked],
    requiredPositionals: ['job'],
    requiredFlags: ['artifact-root'],
    optionalFlags: ['provider', 'handoff-uri'],
    allowedRoles: ['runner', 'operator', 'admin'],
    requiredCapabilities: ['artifact_root_sync', 'completion_claim'],
    capabilities: ['completion_claim'],
  },
  ps: {
    moduleId: 'aios.operator.userland.ps.v0',
    handler: ps,
    packetType: 'aios.operator.ps',
    successExitCode: EXIT_CODES.success,
    failureExitCodes: [EXIT_CODES.invalidInput, EXIT_CODES.runtimeBlocked],
    requiredFlags: ['artifact-root'],
    optionalFlags: ['provider', 'state', 'strict-health'],
    allowedRoles: ['viewer', 'runner', 'approver', 'operator', 'admin'],
    requiredCapabilities: ['artifact_root_sync', 'process_table_read'],
    capabilities: ['process_table_read'],
  },
  logs: {
    moduleId: 'aios.operator.userland.logs.v0',
    handler: logs,
    packetType: 'aios.operator.logs',
    successExitCode: EXIT_CODES.success,
    failureExitCodes: [EXIT_CODES.invalidInput, EXIT_CODES.runtimeBlocked],
    requiredFlags: ['artifact-root'],
    optionalFlags: ['provider', 'process'],
    allowedRoles: ['viewer', 'runner', 'approver', 'operator', 'admin'],
    requiredCapabilities: ['artifact_root_sync', 'lifecycle_log_read'],
    capabilities: ['lifecycle_log_read'],
  },
  approve: {
    moduleId: 'aios.operator.userland.approve.v0',
    handler: approve,
    packetType: 'aios.operator.approval',
    successExitCode: EXIT_CODES.success,
    failureExitCodes: [EXIT_CODES.invalidInput, EXIT_CODES.runtimeBlocked, EXIT_CODES.operatorRejected],
    requiredFlags: ['artifact-root', 'subject'],
    optionalFlags: ['provider', 'decision', 'reason', 'handoff-uri'],
    allowedRoles: ['approver', 'operator', 'admin'],
    requiredCapabilities: ['artifact_root_sync', 'operator_approval_write'],
    capabilities: ['operator_approval_write'],
  },
};

function operatorUserlandManifest() {
  return Object.fromEntries(Object.entries(operatorUserlandModules).map(([name, descriptor]) => [
    name,
    {
      moduleId: descriptor.moduleId,
      packetType: descriptor.packetType,
      successExitCode: descriptor.successExitCode,
      failureExitCodes: descriptor.failureExitCodes,
      requiredPositionals: descriptor.requiredPositionals || [],
      requiredFlags: descriptor.requiredFlags || [],
      optionalFlags: descriptor.optionalFlags || [],
      allowedRoles: descriptor.allowedRoles || [],
      requiredCapabilities: descriptor.requiredCapabilities || [],
      capabilities: normalizeCapabilityList([
        ...baseProviderCapabilities,
        ...(descriptor.capabilities || []),
      ]),
      scopeFlags: ['tenant', 'role', 'operator'],
    },
  ]));
}

const fallbackFailureRequestContext = (descriptor, reason) => ({
  contract: 'aios.operator.request.v0',
  command,
  argv: invocationArgv,
  route: runRoute,
  operatorUserlandModule: descriptor?.moduleId || null,
  expectedPacketType: descriptor?.packetType || null,
  startedAt: invocationStartedAt,
  requestId: `aiosreq_failed_${sha256({ command, invocationArgv, reason }).slice(0, 12)}`,
  argvHash: sha256(invocationArgv),
  scopeError: reason,
  handoff: workflowHandoffFor({ commandName: command }),
});

const emitFailureAndExit = ({ code, reason, details = {}, descriptor = null, operatorRequest = null }) => {
  const exitCode = Number.isInteger(code) ? code : EXIT_CODES.runtimeBlocked;
  console.error(JSON.stringify({
    ok: false,
    command,
    operatorUserlandModule: descriptor?.moduleId || null,
    packetType: descriptor?.packetType || null,
    route: runRoute,
    operatorRequest: operatorRequest || fallbackFailureRequestContext(descriptor, reason),
    reason,
    exitCode,
    exitReason: exitCodeLabels[exitCode] || 'unknown_exit_code',
    ...details,
  }, null, 2));
  process.exit(exitCode);
};

const resolveOperatorUserlandRoute = () => {
  const descriptor = operatorUserlandModules[command];
  if (!descriptor) {
    throw new AiosCliFailure(EXIT_CODES.invalidInput, 'aios_cli_unknown_command', {
      received: command,
      known,
      usage: usage.help,
    });
  }
  if (typeof descriptor.handler !== 'function') {
    throw new AiosCliFailure(EXIT_CODES.runtimeBlocked, 'aios_cli_operator_userland_missing_handler', {
      moduleId: descriptor.moduleId,
    });
  }
  return descriptor;
};

const dispatchOperatorUserland = async () => {
  let descriptor = null;
  let operatorRequest = null;
  try {
    descriptor = resolveOperatorUserlandRoute();
    operatorRequest = createOperatorRequestContext(descriptor);
    await descriptor.handler(operatorRequest);
    if (typeof process.exitCode !== 'number') {
      process.exitCode = descriptor.successExitCode;
    }
  } catch (error) {
    if (error instanceof AiosCliFailure) {
      emitFailureAndExit({
        code: error.code,
        reason: error.reason,
        details: error.details,
        descriptor,
        operatorRequest,
      });
      return;
    }
    emitFailureAndExit({
      code: EXIT_CODES.runtimeBlocked,
      reason: 'aios_cli_operator_userland_failed',
      details: {
        message: error.message,
        stack: process.env.AIOS_CLI_DEBUG ? error.stack : undefined,
      },
      descriptor,
      operatorRequest,
    });
  }
};

await dispatchOperatorUserland();
