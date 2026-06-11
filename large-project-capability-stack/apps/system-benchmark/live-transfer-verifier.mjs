#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function truncateText(value, maxChars = 12000) {
  const text = String(value || '');
  if (text.length <= maxChars) return { text, truncated: false, originalLength: text.length };
  const head = Math.max(1, Math.floor(maxChars * 0.7));
  const tail = Math.max(1, maxChars - head);
  return {
    text: `${text.slice(0, head)}\n...[truncated ${text.length - maxChars} chars]...\n${text.slice(-tail)}`,
    truncated: true,
    originalLength: text.length
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--assignment') args.assignment = argv[index + 1];
    if (token === '--verifier') args.verifier = argv[index + 1];
  }
  return args;
}

function parseJsonFromMixedStdout(stdoutText = '') {
  const text = String(stdoutText || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  for (const line of text.split('\n').map((entry) => entry.trim()).filter(Boolean).reverse()) {
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      return JSON.parse(line);
    } catch {}
  }
  const firstObjectStart = text.indexOf('{');
  const lastObjectEnd = text.lastIndexOf('}');
  if (firstObjectStart >= 0 && lastObjectEnd > firstObjectStart) {
    try {
      return JSON.parse(text.slice(firstObjectStart, lastObjectEnd + 1));
    } catch {}
  }
  return null;
}

function nonNegativeNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

const args = parseArgs(process.argv.slice(2));
if (!args.assignment || !args.verifier) {
  console.error('usage: node live-transfer-verifier.mjs --assignment <path> --verifier <id>');
  process.exit(1);
}

const assignment = JSON.parse(fs.readFileSync(args.assignment, 'utf8'));
const verifierCatalog = {
  ...(assignment.shard?.metadata?.verifierCatalog || {}),
  ...(assignment.inputs?.verifierCatalog || {}),
  ...(assignment.shard?.inputs?.verifierCatalog || {}),
  ...(assignment.contextPack?.inputs?.verifierCatalog || {})
};
const verifier = verifierCatalog[args.verifier] || null;

if (!verifier?.command) {
  console.log(JSON.stringify({
    ok: false,
    verifier: args.verifier,
    error: 'verifier_command_missing',
    assignmentPath: args.assignment
  }));
  process.exit(2);
}

const startedAt = Date.now();
const startedAtIso = new Date(startedAt).toISOString();
const result = spawnSync('bash', ['-lc', verifier.command], {
  cwd: assignment.workspacePath,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20
});
const finishedAt = Date.now();
const finishedAtIso = new Date(finishedAt).toISOString();

const stdout = truncateText(result.stdout || '');
const stderr = truncateText(result.stderr || '');
const parsedOutput = parseJsonFromMixedStdout(result.stdout || '');
const parsedOutputSummary = parsedOutput && typeof parsedOutput === 'object'
  ? {
      ok: parsedOutput.ok !== false,
      scenarioId: parsedOutput.scenarioId || null,
      surfaceId: parsedOutput.surfaceId || null,
      durationMs: parsedOutput.durationMs || null,
      firstMeaningfulProgressMs: nonNegativeNumberOrNull(parsedOutput.firstMeaningfulProgressMs),
      firstMeaningfulProgressAt: parsedOutput.firstMeaningfulProgressAt || null,
      cyclesCompleted: parsedOutput.cyclesCompleted || (Array.isArray(parsedOutput.cycles) ? parsedOutput.cycles.length : null),
      semanticRuntimeExecution: parsedOutput.semanticRuntimeExecution || null,
      checkKinds: Array.from(new Set([
        ...(Array.isArray(parsedOutput.checkKinds) ? parsedOutput.checkKinds : []),
        ...(parsedOutput.cycles || []).flatMap((cycle) => [
          ...(cycle.checks || []).map((check) => check.kind).filter(Boolean),
          ...(Array.isArray(cycle.checkKinds) ? cycle.checkKinds : [])
        ])
      ].filter(Boolean)))
    }
  : null;
const parsedFirstMeaningfulProgressMs = nonNegativeNumberOrNull(parsedOutput?.firstMeaningfulProgressMs);
const firstMeaningfulProgressMs = parsedFirstMeaningfulProgressMs ?? (result.status === 0 ? finishedAt - startedAt : null);
const firstMeaningfulProgressAt = parsedOutput?.firstMeaningfulProgressAt
  || (firstMeaningfulProgressMs != null ? new Date(startedAt + firstMeaningfulProgressMs).toISOString() : null);

console.log(JSON.stringify({
  ok: result.status === 0,
  verifier: args.verifier,
  purpose: verifier.purpose || '',
  surfaceId: verifier.surfaceId || null,
  command: verifier.command,
  startedAt: startedAtIso,
  finishedAt: finishedAtIso,
  durationMs: finishedAt - startedAt,
  firstMeaningfulProgressMs,
  firstMeaningfulProgressAt,
  parsedOutputSummary,
  stdout: stdout.text,
  stderr: stderr.text,
  stdoutTruncated: stdout.truncated,
  stdoutOriginalLength: stdout.originalLength,
  stderrTruncated: stderr.truncated,
  stderrOriginalLength: stderr.originalLength,
  exitCode: result.status,
  signal: result.signal
}));

process.exit(result.status === 0 ? 0 : 3);
