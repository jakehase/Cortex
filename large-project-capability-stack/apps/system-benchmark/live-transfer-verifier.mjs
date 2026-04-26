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

const args = parseArgs(process.argv.slice(2));
if (!args.assignment || !args.verifier) {
  console.error('usage: node live-transfer-verifier.mjs --assignment <path> --verifier <id>');
  process.exit(1);
}

const assignment = JSON.parse(fs.readFileSync(args.assignment, 'utf8'));
const verifierCatalog = assignment.contextPack?.inputs?.verifierCatalog || assignment.shard?.metadata?.verifierCatalog || {};
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
const parsedOutput = (() => {
  try {
    return JSON.parse(String(result.stdout || '').trim() || '{}');
  } catch {
    return null;
  }
})();
const firstMeaningfulProgressMs = Number(parsedOutput?.firstMeaningfulProgressMs || 0) > 0
  ? Number(parsedOutput.firstMeaningfulProgressMs)
  : result.status === 0
    ? finishedAt - startedAt
    : null;

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
  firstMeaningfulProgressAt: firstMeaningfulProgressMs != null ? new Date(startedAt + firstMeaningfulProgressMs).toISOString() : null,
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
