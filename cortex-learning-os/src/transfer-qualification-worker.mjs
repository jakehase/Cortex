import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { routeCodingTransfer } from '../../plugins/cortex-learning-os-live/transfer.mjs';
import { sha256Text } from './hash.mjs';
import { readJson } from './json.mjs';
import { CLOS_ROOT } from './paths.mjs';
import { loadTransferProfile } from './transfer-profiles.mjs';
import { buildTransferTrialOrder, validateTransferRuntime } from './transfer-qualification.mjs';
import { replayTransferOracle, transferTaskSetDigest } from './transfer-tasks.mjs';
import { buildInertTransferProposal } from './transfer-worker-proposal.mjs';

const DIGEST = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const ARMS = ['candidate', 'no-transfer'];
const MAX_RESULT_BYTES = 8192;
const MAX_LEDGER_BYTES = 256 * 1024;
const CONFIG_FILE = 'worker_run_config.json';
const ATTEMPTS_FILE = 'attempts.json';
const CALLS_FILE = 'provider_calls.json';
const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);

function strictFile(root, name) {
  const target = path.join(root, name);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error(`${name} must be an owner-only regular file`);
  return target;
}

function atomicOwnerJson(target, value) {
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, rendered, { mode: 0o600, flag: 'w' });
  fs.renameSync(temporary, target);
  fs.chmodSync(target, 0o600);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function validateFrozenInputs(plan, tasks, profile, policy) {
  const planKeys = new Set([
    'schemaVersion', 'runId', 'generatedAt', 'sourceCommit', 'profileId', 'frozenDigests',
    'runtime', 'budgets', 'evidenceRequirements', 'gates', 'taskIds', 'arms', 'trialOrder', 'terminalOutcomes',
    'truthBoundary', 'controlPlaneSignature',
  ]);
  if (!exactKeys(plan, planKeys) || plan.schemaVersion !== 'cortex.learning_os.transfer_qualification_plan.v1'
      || !ID.test(String(plan.runId || '')) || !Number.isFinite(Date.parse(plan.generatedAt))
      || plan.profileId !== profile.profileId || plan.sourceCommit !== profile.source.baseCommit
      || plan.frozenDigests?.profile !== profile.source.profileDigest
      || plan.frozenDigests?.source !== profile.source.sourceDigest
      || plan.frozenDigests?.policy !== sha256Text(canonicalJson(policy))
      || canonicalJson(plan.budgets) !== canonicalJson(policy.budgets)
      || canonicalJson(plan.evidenceRequirements) !== canonicalJson(policy.evidenceRequirements)
      || canonicalJson(plan.gates) !== canonicalJson(policy.gates)
      || canonicalJson(plan.arms) !== canonicalJson(ARMS)
      || !validateTransferRuntime(plan.runtime).ok
      || plan.controlPlaneSignature?.algorithm !== 'hmac-sha256'
      || !/^[0-9a-f]{16}$/.test(String(plan.controlPlaneSignature?.keyId || ''))
      || !DIGEST.test(String(plan.controlPlaneSignature?.digest || ''))) throw new Error('frozen transfer plan binding is invalid');
  const expectedTrials = new Set(tasks.flatMap((task) => ARMS.map((arm) => `${task.taskId}:${arm}`)));
  const observedTrials = Array.isArray(plan.trialOrder)
    ? plan.trialOrder.map((row) => `${row?.taskId}:${row?.arm}`) : [];
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > plan.budgets.maxTasks
      || tasks.length * ARMS.length > plan.budgets.maxTrials
      || new Set(tasks.map((task) => task.taskId)).size !== tasks.length
      || canonicalJson(plan.taskIds) !== canonicalJson(tasks.map((task) => task.taskId))
      || observedTrials.length !== expectedTrials.size || new Set(observedTrials).size !== expectedTrials.size
      || observedTrials.some((key) => !expectedTrials.has(key))
      || canonicalJson(plan.trialOrder) !== canonicalJson(buildTransferTrialOrder(plan.runId, tasks))
      || plan.frozenDigests.tasks !== transferTaskSetDigest(tasks)) throw new Error('frozen transfer task coverage is invalid');
  for (const task of tasks) {
    const { taskDigest, ...payload } = task || {};
    if (task?.schemaVersion !== 'cortex.learning_os.transfer_task.v1' || task.profileId !== plan.profileId
        || !ID.test(String(task.taskId || '')) || !DIGEST.test(String(taskDigest || ''))
        || taskDigest !== sha256Text(canonicalJson(payload))) throw new Error(`invalid frozen task binding: ${task?.taskId || '<unknown>'}`);
  }
}

function semanticDecision(task, profile) {
  const route = routeCodingTransfer(task.prompt, {
    allowedProfileIds: [profile.profileId],
    selectionMode: 'qualification-worker',
  });
  const row = route.evaluations.find((value) => value.profileId === profile.profileId);
  const required = new Set(profile.requiredAssumptions.map((value) => value.code));
  const observed = row?.observedAssumptionCodes || [];
  const applicable = Boolean(row?.applicable) && row.negativeGateCodes.length === 0
    && [...required].every((code) => observed.includes(code));
  return {
    applicable,
    reasonCodes: row?.applicabilityReasonCodes || route.reasonCodes,
    observedAssumptionCodes: observed,
    negativeGateCodes: row?.negativeGateCodes || [],
  };
}

function promptFor(task, arm, profile, decision) {
  const context = arm === 'candidate' && decision.applicable ? [
    `Computational formulation: ${profile.computationalFormulation}`,
    `Implementation patterns:\n${profile.implementationPatterns.map((row) => `- ${row}`).join('\n')}`,
    `Verification strategy: ${profile.verification.strategy}`,
    `Complexity risk: ${profile.risks.complexity}`,
    `Numerical risk: ${profile.risks.numerical}`,
  ].join('\n\n') : 'No transfer context is supplied for this trial.';
  return [
    'You are taking one bounded coding-transfer evaluation trial.',
    'Answer independently without tools. Return only the requested final value, with no markdown or explanation.',
    'Do not infer or discuss evaluation metadata.',
    context,
    `Task:\n${task.prompt}`,
  ].join('\n\n');
}

function usageFrom(events) {
  const usage = [...events].reverse().map((event) => event?.usage || event?.item?.usage)
    .find((value) => value && typeof value === 'object');
  if (!usage) return null;
  const allowed = ['input_tokens', 'output_tokens', 'cached_input_tokens', 'total_tokens'];
  const result = {};
  for (const key of allowed) if (Number.isSafeInteger(usage[key]) && usage[key] >= 0) result[key] = usage[key];
  return Object.keys(result).length ? result : null;
}

function parseModelOutput(stdout) {
  const events = String(stdout).split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    try { return JSON.parse(line); } catch { throw new Error('model adapter emitted malformed JSONL'); }
  });
  const toolTypes = new Set(['command_execution', 'mcp_tool_call', 'web_search', 'computer', 'tool_call', 'function_call']);
  const toolEvent = events.find((event) => [event?.type, event?.item?.type, event?.name, event?.item?.name]
    .filter(Boolean).map((value) => String(value).toLowerCase()).some((value) => toolTypes.has(value)
      || ['tool_call', 'command_execution', 'web_search', 'mcp_tool', 'computer_call', 'shell_call']
        .some((marker) => value.includes(marker))));
  if (toolEvent) throw new Error('model adapter emitted a prohibited tool event');
  const callId = events.map((event) => event.thread_id || event.call_id || event.id).find((value) => typeof value === 'string' && value);
  const messages = events.flatMap((event) => [
    event?.item?.type === 'agent_message' ? event.item.text : null,
    event?.type === 'agent_message' ? event.text : null,
    event?.type === 'result' ? event.result : null,
  ]).filter((value) => typeof value === 'string');
  if (!ID.test(String(callId || '')) || messages.length !== 1) throw new Error(`model adapter output is incomplete (callId=${Boolean(callId)}, messages=${messages.length})`);
  const result = messages[0].trim();
  if (!result || Buffer.byteLength(result) > MAX_RESULT_BYTES) throw new Error('model result is empty or over budget');
  return { callId, result, usage: usageFrom(events) };
}

function commandIdentity(command, args) {
  return {
    executable: path.basename(command),
    argvDigest: sha256Text(canonicalJson(args)),
  };
}

async function invoke({ command, args, prompt, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-transfer-adapter-'));
    const outputPath = path.join(outputRoot, 'events.jsonl');
    const runtimeArgs = args.map((arg) => arg === '{output}' ? outputPath : arg);
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    const child = spawn(command, runtimeArgs, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv,
    });
    let stdout = '';
    let outBytes = 0;
    let errBytes = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      outBytes += Buffer.byteLength(chunk);
      if (outBytes > 1024 * 1024) child.kill('SIGKILL');
      else stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      errBytes += chunk.length;
      if (errBytes > 64 * 1024) child.kill('SIGKILL');
    });
    child.on('error', reject);
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      if (!stdout && fs.existsSync(outputPath)) stdout = fs.readFileSync(outputPath, 'utf8');
      fs.rmSync(outputRoot, { recursive: true, force: true });
      resolve({ status, signal, stdout, stderrBytes: errBytes });
    });
    child.stdin.end(prompt);
  });
}

function validateResumeRows(attempts, calls, expected, config) {
  if (!Array.isArray(attempts) || !Array.isArray(calls) || attempts.length !== calls.length
      || attempts.length > expected.length || Buffer.byteLength(JSON.stringify(calls)) > MAX_LEDGER_BYTES) throw new Error('invalid resumable worker artifacts');
  const seen = new Set();
  const seenCallIds = new Set();
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    const call = calls[index];
    const key = `${attempt?.taskId}:${attempt?.arm}`;
    const target = expected.find((row) => row.key === key);
    const start = Date.parse(attempt?.startedAt);
    const end = Date.parse(attempt?.completedAt);
    if (!target || seen.has(key) || seenCallIds.has(call?.callId) || call.taskId !== attempt.taskId || call.arm !== attempt.arm
        || call.model !== config.model || call.commandIdentity?.argvDigest !== config.commandIdentity.argvDigest
        || call.callId !== attempt.attemptId || !Number.isFinite(start) || !Number.isFinite(end) || end <= start
        || call.startedAt !== attempt.startedAt || call.completedAt !== attempt.completedAt
        || call.exitStatus !== 0 || !(call.runtimeMs > 0)) throw new Error('resumable worker artifact binding is invalid');
    seen.add(key);
    seenCallIds.add(call.callId);
  }
}

export async function runTransferQualification({
  artifactRoot,
  model,
  concurrency = 1,
  modelCommand = 'codex',
  modelArgs = null,
  reasoningEffort = 'low',
  timeoutMs = 300000,
} = {}) {
  const root = path.resolve(artifactRoot);
  if (!model || typeof model !== 'string' || model.length > 128 || !Number.isSafeInteger(concurrency)
      || concurrency < 1 || concurrency > 8 || !REASONING_EFFORTS.has(reasoningEffort)
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 900000) throw new Error('invalid worker runtime configuration');
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o077) !== 0) throw new Error('artifact root must be an owner-only regular directory');
  const plan = JSON.parse(fs.readFileSync(strictFile(root, 'plan.json'), 'utf8'));
  const tasks = JSON.parse(fs.readFileSync(strictFile(root, 'tasks.json'), 'utf8'));
  const graph = readJson(path.join(CLOS_ROOT, 'capsules/math-foundations/curriculum.graph.json'));
  const policy = readJson(path.join(CLOS_ROOT, 'policies/coding-transfer-v0.9.json'));
  const profile = loadTransferProfile(plan.profileId, { graph });
  validateFrozenInputs(plan, tasks, profile, policy);
  if (model !== plan.runtime.model || reasoningEffort !== plan.runtime.reasoningEffort) throw new Error('worker runtime does not match frozen plan');
  if (plan.runtime.runner === 'codex-exec-ephemeral'
      && (path.basename(modelCommand) !== 'codex' || modelArgs !== null)) throw new Error('frozen Codex runtime requires the canonical adapter');
  const args = modelArgs || [
    'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only',
    '--skip-git-repo-check', '--model', model, '--config', `model_reasoning_effort="${reasoningEffort}"`, '--json', '-',
  ];
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || arg.length > 2048)) throw new Error('invalid model adapter arguments');
  const configPayload = {
    schemaVersion: 'cortex.learning_os.transfer_worker_run_config.v1',
    runId: plan.runId,
    profileId: plan.profileId,
    planDigest: sha256Text(canonicalJson(plan)),
    tasksDigest: transferTaskSetDigest(tasks),
    model,
    reasoningEffort,
    concurrency,
    timeoutMs,
    commandIdentity: commandIdentity(modelCommand, args),
  };
  const config = { ...configPayload, configDigest: sha256Text(canonicalJson(configPayload)) };
  const configPath = path.join(root, CONFIG_FILE);
  if (fs.existsSync(configPath)) {
    const stored = JSON.parse(fs.readFileSync(strictFile(root, CONFIG_FILE), 'utf8'));
    if (canonicalJson(stored) !== canonicalJson(config)) throw new Error('worker run configuration drift');
  } else atomicOwnerJson(configPath, config);
  let attempts = fs.existsSync(path.join(root, ATTEMPTS_FILE))
    ? JSON.parse(fs.readFileSync(strictFile(root, ATTEMPTS_FILE), 'utf8')) : [];
  let calls = fs.existsSync(path.join(root, CALLS_FILE))
    ? JSON.parse(fs.readFileSync(strictFile(root, CALLS_FILE), 'utf8')) : [];
  const taskById = new Map(tasks.map((task) => [task.taskId, task]));
  const expected = plan.trialOrder.map((row) => ({ task: taskById.get(row.taskId), arm: row.arm, key: `${row.taskId}:${row.arm}` }));
  validateResumeRows(attempts, calls, expected, config);
  async function execute(row) {
    const decision = semanticDecision(row.task, profile);
    const prompt = promptFor(row.task, row.arm, profile, decision);
    if (prompt.includes(row.task.expected)) throw new Error(`expected answer leaked into prompt for ${row.key}`);
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const processResult = await invoke({ command: modelCommand, args, prompt, timeoutMs });
    const completed = Math.max(Date.now(), started + 1);
    const completedAt = new Date(completed).toISOString();
    if (processResult.status !== 0) throw new Error(`model adapter failed for ${row.key}`);
    const parsed = parseModelOutput(processResult.stdout);
    const oracle = replayTransferOracle(row.task, parsed.result);
    const payload = {
      schemaVersion: 'cortex.learning_os.transfer_attempt.v1',
      attemptId: parsed.callId,
      runId: plan.runId,
      profileId: plan.profileId,
      taskId: row.task.taskId,
      taskDigest: row.task.taskDigest,
      family: row.task.family,
      arm: row.arm,
      valid: true,
      validityReasonCode: 'worker-proposed',
      semanticDecision: decision,
      oracle,
      result: parsed.result,
      startedAt,
      completedAt,
    };
    const attempt = { ...payload, evidenceDigest: sha256Text(canonicalJson(payload)) };
    const call = {
      callId: parsed.callId,
      taskId: row.task.taskId,
      arm: row.arm,
      provider: plan.runtime.provider,
      model,
      commandIdentity: config.commandIdentity,
      runtimeContractDigest: sha256Text(canonicalJson(plan.runtime)),
      startedAt,
      completedAt,
      runtimeMs: completed - started,
      exitStatus: processResult.status,
      usage: parsed.usage,
    };
    return { attempt, call };
  }
  const completedKeys = new Set(attempts.map((row) => `${row.taskId}:${row.arm}`));
  const pending = expected.filter((row) => !completedKeys.has(row.key));
  for (let cursor = 0; cursor < pending.length; cursor += concurrency) {
    const batch = pending.slice(cursor, cursor + concurrency);
    const settled = await Promise.allSettled(batch.map((row) => execute(row)));
    for (const entry of settled) {
      if (entry.status !== 'fulfilled') continue;
      attempts.push(entry.value.attempt);
      calls.push(entry.value.call);
      if (attempts.length > plan.budgets.maxTrials || Buffer.byteLength(JSON.stringify(calls)) > MAX_LEDGER_BYTES) throw new Error('worker artifact budget exceeded');
      atomicOwnerJson(path.join(root, ATTEMPTS_FILE), attempts);
      atomicOwnerJson(path.join(root, CALLS_FILE), calls);
    }
    const failure = settled.find((entry) => entry.status === 'rejected');
    if (failure) throw failure.reason;
  }
  const order = new Map(expected.map((row, index) => [row.key, index]));
  const ordered = attempts.map((attempt, index) => ({ attempt, call: calls[index] }))
    .sort((left, right) => order.get(`${left.attempt.taskId}:${left.attempt.arm}`) - order.get(`${right.attempt.taskId}:${right.attempt.arm}`));
  attempts = ordered.map((row) => row.attempt);
  calls = ordered.map((row) => row.call);
  atomicOwnerJson(path.join(root, ATTEMPTS_FILE), attempts);
  atomicOwnerJson(path.join(root, CALLS_FILE), calls);
  fs.unlinkSync(configPath);
  const completedAt = new Date().toISOString();
  const { proposal, manifest } = buildInertTransferProposal({
    artifactRoot: root, plan, tasks, attempts, providerCalls: calls, completedAt, claimedOutcome: 'candidate',
  });
  return { plan, tasks, attempts, providerCalls: calls, proposal, manifest };
}
