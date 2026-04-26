#!/usr/bin/env node
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

function runVerifier(assignmentPath, assignment, verifierId) {
  const command = [process.execPath, assignment.verifierScriptPath, '--assignment', assignmentPath, '--verifier', verifierId];
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  try {
    const stdout = execFileSync(command[0], command.slice(1), {
      cwd: assignment.workspacePath,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    const parsed = JSON.parse(String(stdout).trim() || '{}');
    const finishedAt = Date.now();
    const finishedAtIso = new Date(finishedAt).toISOString();
    const durationMs = parsed.durationMs || finishedAt - startedAt;
    const firstMeaningfulProgressMs = Number(parsed.firstMeaningfulProgressMs || 0) > 0
      ? Number(parsed.firstMeaningfulProgressMs)
      : durationMs;
    return {
      ok: parsed.ok !== false,
      verifier: verifierId,
      command: parsed.command || command.join(' '),
      startedAt: parsed.startedAt || startedAtIso,
      finishedAt: parsed.finishedAt || finishedAtIso,
      durationMs,
      firstMeaningfulProgressMs,
      firstMeaningfulProgressAt: parsed.firstMeaningfulProgressAt || new Date(startedAt + firstMeaningfulProgressMs).toISOString(),
      stdout: parsed.stdout || String(stdout).trim(),
      stderr: parsed.stderr || '',
      metadata: parsed
    };
  } catch (error) {
    const stdout = `${error.stdout || ''}`.trim();
    const stderr = `${error.stderr || ''}${error.message || ''}`.trim();
    let parsed = {};
    try {
      parsed = JSON.parse(stdout || '{}');
    } catch {}
    const finishedAt = Date.now();
    const finishedAtIso = new Date(finishedAt).toISOString();
    const durationMs = parsed.durationMs || finishedAt - startedAt;
    const firstMeaningfulProgressMs = Number(parsed.firstMeaningfulProgressMs || 0) > 0
      ? Number(parsed.firstMeaningfulProgressMs)
      : null;
    return {
      ok: false,
      verifier: verifierId,
      command: parsed.command || command.join(' '),
      startedAt: parsed.startedAt || startedAtIso,
      finishedAt: parsed.finishedAt || finishedAtIso,
      durationMs,
      firstMeaningfulProgressMs,
      firstMeaningfulProgressAt: parsed.firstMeaningfulProgressAt || (firstMeaningfulProgressMs != null ? new Date(startedAt + firstMeaningfulProgressMs).toISOString() : null),
      stdout: parsed.stdout || stdout,
      stderr: parsed.stderr || stderr,
      metadata: parsed
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

const implementation = {
  ok: true,
  command: null,
  durationMs: 0,
  modifiedFiles: [],
  diffSummary: 'verification-only transfer shard',
  stdout: '',
  stderr: '',
  metadata: {
    benchmarkMode: 'verification_only',
    surfaceId: assignment.shard?.metadata?.surfaceId || assignment.shard?.id || null
  }
};
fs.appendFileSync(assignment.logPath, `${JSON.stringify({ type: 'implementation', ...implementation })}\n`);

const verifierResults = [];
for (const verifierId of assignment.shard.requiredVerifiers || []) {
  const result = runVerifier(args.assignment, assignment, verifierId);
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
      elapsedMs: Date.now() - startedAt,
      contextPack: {
        shardId: assignment.contextPack?.shard?.id || assignment.shard.id,
        guardrails: assignment.contextPack?.guardrails || null,
        acceptanceChecks: assignment.contextPack?.acceptanceChecks || []
      }
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
