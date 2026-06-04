import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--assignment') args.assignment = argv[index + 1];
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runVerifier(verifier, assignment) {
  const command = [process.execPath, assignment.verifierScriptPath, verifier, assignment.workspacePath, assignment.shard.metadata.fixtureModuleId];
  const startedAt = Date.now();
  try {
    const stdout = execFileSync(command[0], command.slice(1), {
      cwd: assignment.workspacePath,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    const parsed = JSON.parse(String(stdout).trim());
    return {
      ok: parsed.ok !== false,
      verifier,
      command: command.join(' '),
      durationMs: Date.now() - startedAt,
      stdout: String(stdout).trim(),
      stderr: ''
    };
  } catch (error) {
    const stdout = `${error.stdout || ''}`.trim();
    const stderr = `${error.stderr || ''}${error.message || ''}`.trim();
    return {
      ok: false,
      verifier,
      command: command.join(' '),
      durationMs: Date.now() - startedAt,
      stdout,
      stderr
    };
  }
}

function runImplementation(assignmentPath, assignment) {
  if (!assignment.implementationScriptPath) {
    return {
      ok: true,
      command: null,
      durationMs: 0,
      modifiedFiles: [],
      diffSummary: 'verification-only shard',
      stdout: '',
      stderr: '',
      metadata: {}
    };
  }

  const command = [process.execPath, assignment.implementationScriptPath, '--assignment', assignmentPath];
  const startedAt = Date.now();
  try {
    const stdout = execFileSync(command[0], command.slice(1), {
      cwd: assignment.workspacePath,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    const parsed = JSON.parse(String(stdout).trim() || '{}');
    return {
      ok: parsed.ok !== false,
      command: command.join(' '),
      durationMs: Date.now() - startedAt,
      modifiedFiles: parsed.modifiedFiles || [],
      diff: parsed.diff || parsed.unifiedDiff || parsed.patch || '',
      unifiedDiff: parsed.unifiedDiff || parsed.diff || parsed.patch || '',
      diffSummary: parsed.diffSummary || 'implemented shard changes',
      stdout: String(stdout).trim(),
      stderr: '',
      metadata: parsed.metadata || {}
    };
  } catch (error) {
    return {
      ok: false,
      command: command.join(' '),
      durationMs: Date.now() - startedAt,
      modifiedFiles: [],
      diffSummary: 'implementation failed',
      stdout: `${error.stdout || ''}`.trim(),
      stderr: `${error.stderr || ''}${error.message || ''}`.trim(),
      metadata: {}
    };
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args.assignment) {
  console.error('missing --assignment');
  process.exit(1);
}

const assignment = JSON.parse(fs.readFileSync(args.assignment, 'utf8'));
const failureInjection = assignment.failureInjection || null;
const startedAt = Date.now();

if (failureInjection?.mode === 'crash') {
  fs.appendFileSync(assignment.logPath, `[crash-injection] ${failureInjection.note || 'deterministic crash'}\n`);
  process.exit(85);
}

if (failureInjection?.mode === 'stall') {
  fs.appendFileSync(assignment.logPath, `[stall-injection] ${failureInjection.note || 'deterministic stall'} delayMs=${failureInjection.delayMs || 0}\n`);
  await sleep(Number(failureInjection.delayMs || 0));
}

const implementation = runImplementation(args.assignment, assignment);
fs.appendFileSync(assignment.logPath, `${JSON.stringify({ type: 'implementation', ...implementation })}\n`);
if (implementation.ok === false) {
  fs.writeFileSync(assignment.resultPath, JSON.stringify({
    ok: false,
    shardId: assignment.shard.id,
    leaseId: assignment.lease.leaseId,
    agentId: assignment.agentId,
    executionMode: assignment.executionMode,
    implementation,
    verifierResults: [],
    elapsedMs: Date.now() - startedAt
  }, null, 2));
  process.exit(2);
}

const verifierResults = [];
for (const verifier of assignment.shard.requiredVerifiers || []) {
  const result = runVerifier(verifier, assignment);
  verifierResults.push(result);
  fs.appendFileSync(assignment.logPath, `${JSON.stringify(result)}\n`);
  if (result.ok === false) {
    fs.writeFileSync(assignment.resultPath, JSON.stringify({
      ok: false,
      shardId: assignment.shard.id,
      leaseId: assignment.lease.leaseId,
      agentId: assignment.agentId,
      executionMode: assignment.executionMode,
      implementation,
      verifierResults,
      elapsedMs: Date.now() - startedAt
    }, null, 2));
    process.exit(2);
  }
}

fs.writeFileSync(assignment.resultPath, JSON.stringify({
  ok: true,
  shardId: assignment.shard.id,
  leaseId: assignment.lease.leaseId,
  agentId: assignment.agentId,
  executionMode: assignment.executionMode,
  implementation,
  verifierResults,
  elapsedMs: Date.now() - startedAt,
  contextPack: {
    shardId: assignment.contextPack?.shard?.id || assignment.shard.id,
    guardrails: assignment.contextPack?.guardrails || null,
    acceptanceChecks: assignment.contextPack?.acceptanceChecks || []
  }
}, null, 2));
console.log(JSON.stringify({ ok: true, shardId: assignment.shard.id, leaseId: assignment.lease.leaseId }));
