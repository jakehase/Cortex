#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildRemoteCompletionHandoff,
  defaultCompletionHandoffPath,
} from './remote-completion-handoff.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const defaultConfigPath = path.join(root, 'config/worker-launch/default.json');
const schemaVersion = 'clawd.codex_worker_launch.v2';
const supportedModels = new Set(['gpt-5.6-sol']);
const supportedSandboxes = new Set(['read-only', 'workspace-write']);
const supportedReasoningEfforts = new Set(['ultra']);

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      parsed._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function readConfig(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeBytes(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes, { mode: 0o600 });
}

function writeJson(filePath, value) {
  writeBytes(filePath, jsonBytes(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function safeHost(value) {
  return /^[A-Za-z0-9._-]+@[A-Za-z0-9.:[\]-]+$/.test(value);
}

function safeAbsoluteRemotePath(value) {
  return path.posix.isAbsolute(value) && /^\/[A-Za-z0-9._/-]+$/.test(value);
}

function safeModel(value) {
  return supportedModels.has(value);
}

function safeSandbox(value) {
  return supportedSandboxes.has(value);
}

function safeReasoningEffort(value) {
  return supportedReasoningEfforts.has(value);
}

function sshScript({ host, args, script, timeoutMs, input = '' }) {
  const spoolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-worker-ssh-'));
  const stdoutPath = path.join(spoolDir, 'stdout.log');
  const stderrPath = path.join(spoolDir, 'stderr.log');
  let stdoutFd;
  let stderrFd;
  try {
    stdoutFd = fs.openSync(stdoutPath, 'w');
    stderrFd = fs.openSync(stderrPath, 'w');
    const run = spawnSync('ssh', [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=8',
      host,
      'bash', '-s', '--', ...args
    ], {
      input: `${script}\n${input}`,
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['pipe', stdoutFd, stderrFd]
    });
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
    stdoutFd = undefined;
    stderrFd = undefined;
    return Object.assign(run, {
      stdout: fs.readFileSync(stdoutPath, 'utf8'),
      stderr: fs.readFileSync(stderrPath, 'utf8')
    });
  } finally {
    if (stdoutFd !== undefined) fs.closeSync(stdoutFd);
    if (stderrFd !== undefined) fs.closeSync(stderrFd);
    fs.rmSync(spoolDir, { recursive: true, force: true });
  }
}

function classifyPreflightFailure(run) {
  if (run.error?.code === 'ETIMEDOUT') return ['execution_plane_preflight', 'transport_timeout'];
  if (run.status === 255) return ['execution_plane_preflight', 'transport_unavailable'];
  if (run.status === 41) return ['execution_plane_preflight', 'worker_command_not_executable'];
  if (run.status === 42) return ['execution_plane_preflight', 'worker_workspace_missing'];
  if (run.status === 43) return ['execution_plane_preflight', 'worker_workspace_not_writable'];
  if (run.status === 44) return ['execution_plane_preflight', 'provider_authentication_failed'];
  return ['execution_plane_preflight', run.error?.code || `preflight_exit_${run.status ?? 'unknown'}`];
}

function preflight(options) {
  const invalid = [];
  if (!safeHost(options.host)) invalid.push('invalid_execution_host');
  if (!safeAbsoluteRemotePath(options.codexBin)) invalid.push('explicit_absolute_codex_bin_required');
  if (!safeAbsoluteRemotePath(options.workspace)) invalid.push('explicit_absolute_workspace_required');
  if (!safeModel(options.model)) invalid.push('unsupported_model');
  if (!safeSandbox(options.sandbox)) invalid.push('unsupported_sandbox');
  if (!safeReasoningEffort(options.reasoningEffort)) invalid.push('unsupported_reasoning_effort');
  if (options.serviceTierOverride !== null) invalid.push('service_tier_override_not_supported');
  if (invalid.length) {
    return {
      ok: false,
      stage: 'admission',
      code: invalid[0],
      checks: invalid,
      launchConfirmed: false
    };
  }
  const script = String.raw`set -uo pipefail
codex_bin="$1"
workspace="$2"
[[ -x "$codex_bin" ]] || exit 41
[[ -d "$workspace" ]] || exit 42
[[ -w "$workspace" ]] || exit 43
"$codex_bin" login status >/dev/null 2>&1 || exit 44
printf 'preflight_ok\n'
`;
  const run = sshScript({
    host: options.host,
    args: [options.codexBin, options.workspace],
    script,
    timeoutMs: options.transportTimeoutMs
  });
  if (run.status !== 0 || run.error) {
    const [stage, code] = classifyPreflightFailure(run);
    return {
      ok: false,
      stage,
      code,
      launchConfirmed: false,
      exitCode: run.status,
      signal: run.signal || null,
      stderr: String(run.stderr || '').slice(-2000)
    };
  }
  return {
    ok: true,
    stage: 'execution_plane_preflight',
    code: null,
    checks: {
      transport: true,
      explicitExecutable: true,
      workspaceExists: true,
      workspaceWritable: true,
      providerAuthenticated: true
    },
    launchConfirmed: false,
    truthBoundary: 'Preflight is green; no worker/model turn has started yet.'
  };
}

function parseCodexJsonl(stdout) {
  const events = [];
  const turnStartedIndexes = [];
  const turnCompletedIndexes = [];
  const finalMessageIndexes = [];
  const terminalFailureTypes = [];
  let callsStarted = 0;
  let callsCompleted = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let index = -1;
  for (const line of String(stdout || '').split(/\r?\n/).filter(Boolean)) {
    index += 1;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const type = String(event.type || event.event || event.kind || '');
    if (type) events.push(type);
    if (type === 'turn.started') {
      callsStarted += 1;
      turnStartedIndexes.push(index);
    }
    if (type === 'turn.completed') {
      callsCompleted += 1;
      turnCompletedIndexes.push(index);
    }
    if (type === 'item.completed' && event?.item?.type === 'agent_message' && String(event.item.text || '').trim()) {
      finalMessageIndexes.push(index);
    }
    if (/^(?:turn\.(?:failed|cancelled|canceled)|error|fatal|cancelled|canceled)$/.test(type)) {
      terminalFailureTypes.push(type);
    }
    const usage = event.usage || event.response?.usage || event.data?.usage || {};
    inputTokens += Number(usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens ?? 0) || 0;
    outputTokens += Number(usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens ?? 0) || 0;
    reasoningTokens += Number(usage.reasoning_output_tokens ?? usage.reasoningOutputTokens ?? 0) || 0;
  }
  const orderedSingleTurn = callsStarted === 1
    && callsCompleted === 1
    && finalMessageIndexes.length > 0
    && turnStartedIndexes[0] < finalMessageIndexes.at(-1)
    && finalMessageIndexes.at(-1) < turnCompletedIndexes[0];
  const tokensObserved = inputTokens + outputTokens + reasoningTokens;
  return {
    eventTypes: events,
    callsStarted,
    callsCompleted,
    inputTokens,
    outputTokens,
    reasoningTokens,
    tokensObserved,
    orderedSingleTurn,
    finalAgentMessageObserved: finalMessageIndexes.length > 0,
    terminalFailureObserved: terminalFailureTypes.length > 0,
    terminalFailureTypes,
    eventStreamSha256: sha256(String(stdout || '')),
  };
}

function execute(options, prompt) {
  const checked = preflight(options);
  if (!checked.ok) return { preflight: checked, run: null };
  const promptBase64 = Buffer.from(prompt, 'utf8').toString('base64');
  const script = String.raw`set -uo pipefail
codex_bin="$1"
workspace="$2"
model="$3"
sandbox="$4"
prompt_b64="$5"
cd "$workspace" || exit 42
prompt="$(printf '%s' "$prompt_b64" | base64 -d)" || exit 45
exec "$codex_bin" exec --json --skip-git-repo-check --sandbox "$sandbox" --model "$model" -c 'model_reasoning_effort="ultra"' "$prompt"
`;
  const startedAt = new Date().toISOString();
  const run = sshScript({
    host: options.host,
    args: [options.codexBin, options.workspace, options.model, options.sandbox, promptBase64],
    script,
    timeoutMs: options.providerTimeoutMs
  });
  const usage = parseCodexJsonl(run.stdout);
  const launchConfirmed = usage.callsStarted > 0;
  const completionConfirmed = usage.callsCompleted > 0;
  const ok = run.status === 0
    && !run.error
    && launchConfirmed
    && completionConfirmed
    && usage.tokensObserved > 0
    && usage.orderedSingleTurn
    && usage.finalAgentMessageObserved
    && !usage.terminalFailureObserved;
  let failureStage = null;
  let failureCode = null;
  if (!ok) {
    if (run.error || run.status === 255) {
      failureStage = launchConfirmed ? 'worker_execution' : 'process_launch';
      failureCode = run.error?.code || (run.status === 255 ? 'transport_lost_during_launch' : 'process_launch_failed');
    } else if (!launchConfirmed) {
      failureStage = 'process_launch';
      failureCode = 'worker_start_not_observed';
    } else {
      failureStage = 'worker_execution';
      if (!completionConfirmed) failureCode = 'worker_completion_not_observed';
      else if (usage.terminalFailureObserved) failureCode = 'terminal_failure_event_observed';
      else if (!usage.orderedSingleTurn) failureCode = 'ordered_single_turn_not_observed';
      else if (!usage.finalAgentMessageObserved) failureCode = 'final_agent_message_not_observed';
      else if (usage.tokensObserved <= 0) failureCode = 'provider_usage_not_observed';
      else failureCode = `worker_exit_${run.status}`;
    }
  }
  return {
    preflight: checked,
    run: {
      ok,
      startedAt,
      completedAt: new Date().toISOString(),
      launchConfirmed,
      completionConfirmed,
      failureStage,
      failureCode,
      exitCode: run.status,
      signal: run.signal || null,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      serviceTier: {
        requested: null,
        transmitted: false,
        providerConfirmed: false,
        policy: 'provider_default_no_override',
      },
      sandbox: options.sandbox,
      providerUsage: usage,
      sourceIdentity: options.sourceIdentity,
      stdout: String(run.stdout || '').slice(-200000),
      stderr: String(run.stderr || '').slice(-10000),
      truthBoundary: launchConfirmed
        ? 'A provider turn started. Completion and token evidence are reported separately.'
        : 'No provider turn start was observed; this must not be reported as started.'
    }
  };
}

const cli = parseArgs(process.argv.slice(2));
const action = cli._[0] || 'preflight';
const configPath = path.resolve(cli.config || defaultConfigPath);
const config = readConfig(configPath);
const configuredServiceTier = Object.prototype.hasOwnProperty.call(config, 'serviceTierOverride')
  ? config.serviceTierOverride
  : (Object.prototype.hasOwnProperty.call(config, 'serviceTier') ? config.serviceTier : null);
const requestedServiceTier = Object.prototype.hasOwnProperty.call(cli, 'service-tier')
  ? cli['service-tier']
  : configuredServiceTier;
const sourceIdentity = {
  launcherSha256: sha256File(fileURLToPath(import.meta.url)),
  handoffModuleSha256: sha256File(path.join(here, 'remote-completion-handoff.mjs')),
  configSha256: sha256File(configPath),
};
const options = {
  host: String(cli.host || process.env.CODEX_EXECUTION_HOST || config.executionPlane.host),
  codexBin: String(cli['codex-bin'] || process.env.CODEX_BIN || config.executionPlane.codexBin),
  workspace: String(cli.workspace || process.env.CODEX_WORKSPACE || config.executionPlane.workspace),
  model: String(cli.model || config.model),
  reasoningEffort: String(cli['reasoning-effort'] || config.reasoningEffort),
  serviceTierOverride: requestedServiceTier === null || requestedServiceTier === undefined
    ? null
    : String(requestedServiceTier),
  sandbox: String(cli.sandbox || (action === 'smoke' ? 'read-only' : config.sandbox)),
  transportTimeoutMs: Number(cli['transport-timeout-ms'] || config.timeoutsMs.transport),
  providerTimeoutMs: Number(cli['provider-timeout-ms'] || config.timeoutsMs.provider),
  sourceIdentity,
};

let result;
if (action === 'preflight') {
  const checked = preflight(options);
  result = {
    schemaVersion,
    action,
    generatedAt: new Date().toISOString(),
    configPath,
    executionPlane: { host: options.host, codexBin: options.codexBin, workspace: options.workspace },
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    serviceTier: {
      requested: options.serviceTierOverride,
      transmitted: false,
      providerConfirmed: false,
      policy: 'provider_default_no_override',
    },
    sandbox: options.sandbox,
    sourceIdentity,
    ...checked
  };
} else if (action === 'exec' || action === 'smoke') {
  const prompt = action === 'smoke'
    ? 'This is a worker-launch reliability smoke test. Do not modify files. Reply with exactly WORKER_LAUNCH_OK.'
    : String(cli.prompt || '');
  if (!prompt) throw new Error('--prompt is required for exec');
  const execution = execute(options, prompt);
  result = {
    schemaVersion,
    action,
    generatedAt: new Date().toISOString(),
    configPath,
    executionPlane: { host: options.host, codexBin: options.codexBin, workspace: options.workspace },
    preflight: execution.preflight,
    ...(execution.run || {
      ok: false,
      launchConfirmed: false,
      completionConfirmed: false,
      failureStage: execution.preflight.stage,
      failureCode: execution.preflight.code,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      serviceTier: {
        requested: options.serviceTierOverride,
        transmitted: false,
        providerConfirmed: false,
        policy: 'provider_default_no_override',
      },
      sandbox: options.sandbox,
      sourceIdentity,
    })
  };
  if (action === 'smoke' && result.ok && !result.stdout.includes('WORKER_LAUNCH_OK')) {
    result.ok = false;
    result.failureStage = 'supervisor_verification';
    result.failureCode = 'smoke_sentinel_missing';
  }
} else {
  throw new Error(`unknown action: ${action}`);
}

const resultArtifact = cli.artifact ? path.resolve(cli.artifact) : null;
const handoffArtifact = action === 'exec' || action === 'smoke'
  ? (cli['handoff-artifact']
      ? path.resolve(cli['handoff-artifact'])
      : (resultArtifact ? defaultCompletionHandoffPath(resultArtifact) : null))
  : null;
if (handoffArtifact && resultArtifact && handoffArtifact === resultArtifact) {
  throw new Error('completion handoff artifact must differ from the worker result artifact');
}
let consoleResult = result;
if (action === 'exec' || action === 'smoke') {
  if (resultArtifact) result.resultArtifactPath = resultArtifact;
  if (handoffArtifact) result.completionHandoffArtifact = handoffArtifact;
  const resultBytes = jsonBytes(result);
  if (resultArtifact) writeBytes(resultArtifact, resultBytes);
  const resultArtifactBinding = {
    path: resultArtifact,
    sha256: sha256(resultBytes),
    bytes: resultBytes.length,
    persisted: Boolean(resultArtifact),
  };
  const completionHandoff = buildRemoteCompletionHandoff({
    result,
    project: cli.project,
    task: cli.task,
    completionSummary: cli['completion-summary'],
    remainingWork: cli['remaining-work'],
    resultArtifact: resultArtifactBinding,
  });
  if (handoffArtifact) writeJson(handoffArtifact, completionHandoff);
  consoleResult = { ...result, completionHandoff };
} else if (resultArtifact) {
  writeJson(resultArtifact, result);
}
if (handoffArtifact) {
  result.completionHandoffArtifact = handoffArtifact;
}
process.stdout.write(`${JSON.stringify(consoleResult, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
