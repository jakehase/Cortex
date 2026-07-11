#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DONE_MARKER = 'SLOS_CODEX_AGENT_WORK_ITEM_DONE';
const TRUTH_BOUNDARY = 'Remote Codex agent work item only; no merge/publish/broad-scale proof.';
const DEFAULT_CONTEXT_FILES = Object.freeze([
  'packages/synthetic-labor-os/index.mjs',
  'apps/synthetic-labor-os/codex-agent-work-item.mjs',
  'apps/synthetic-labor-os/v3-remote-codex-pilot.mjs',
  'docs/SYNTHETIC_LABOR_OS_V0.md'
]);

function parseArgs(argv) {
  const args = {
    jobId: 'slos-v3-codex-agent-work-item',
    artifactRoot: 'artifacts/synthetic-labor-os-v3/latest',
    repoRoot: process.cwd(),
    codexBin: process.env.CODEX_BIN || 'codex',
    model: process.env.SYNTHETIC_LABOR_OS_CODEX_MODEL || '',
    maxRuntimeMs: Number(process.env.SYNTHETIC_LABOR_OS_CODEX_MAX_RUNTIME_MS || 120000),
    workItem: 'remote-codex-bounded-audit',
    contextFiles: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--job-id') { args.jobId = next; index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--repo-root') { args.repoRoot = next; index += 1; continue; }
    if (token === '--codex-bin') { args.codexBin = next; index += 1; continue; }
    if (token === '--model') { args.model = next; index += 1; continue; }
    if (token === '--max-runtime-ms') { args.maxRuntimeMs = Number(next); index += 1; continue; }
    if (token === '--work-item') { args.workItem = next; index += 1; continue; }
    if (token === '--context-file') { args.contextFiles.push(next); index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log(`usage:
  node apps/synthetic-labor-os/codex-agent-work-item.mjs --job-id JOB --artifact-root ROOT [--repo-root DIR] [--codex-bin PATH]

Runs one bounded read-only Codex CLI work item, writes provenance/evidence artifacts, and exits nonzero unless the Codex output verifies. This does not merge, publish, send externally, or prove broad scale.`);
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (!args.jobId) throw new Error('--job-id is required');
  if (!args.artifactRoot) throw new Error('--artifact-root is required');
  if (!Number.isFinite(args.maxRuntimeMs) || args.maxRuntimeMs < 1000) args.maxRuntimeMs = 120000;
  if (!args.contextFiles.length) args.contextFiles = Array.from(DEFAULT_CONTEXT_FILES);
  return args;
}

function safeFileStamp(value = new Date().toISOString()) {
  return String(value).replace(/[^0-9A-Za-z_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function readText(filePath, fallback = '') {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch { return fallback; }
}

function commandForDisplay(command, args = []) {
  return [command, ...args].map((part) => {
    const value = String(part ?? '');
    return /[^A-Za-z0-9_./:=@+-]/.test(value) ? JSON.stringify(value) : value;
  }).join(' ');
}

function sha256Text(text = '') {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function trimMiddle(value = '', maxChars = 9000) {
  const text = String(value || '');
  const limit = Math.max(1000, Number(maxChars) || 9000);
  if (text.length <= limit) return { text, truncated: false, originalChars: text.length, includedChars: text.length };
  const head = Math.floor(limit * 0.62);
  const tail = Math.max(500, limit - head - 120);
  const trimmed = `${text.slice(0, head)}\n\n...[trimmed ${text.length - head - tail} chars for bounded Codex context pack]...\n\n${text.slice(-tail)}`;
  return { text: trimmed, truncated: true, originalChars: text.length, includedChars: trimmed.length };
}

function buildContextPack(repoRoot, relPaths = []) {
  const files = [];
  for (const relPath of relPaths) {
    const normalized = String(relPath || '').replace(/^\/+/, '');
    if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) {
      files.push({ relPath, included: false, reason: 'unsafe_relative_path' });
      continue;
    }
    const absolutePath = path.join(repoRoot, normalized);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      files.push({ relPath: normalized, absolutePath, included: false, reason: 'missing_file' });
      continue;
    }
    const raw = fs.readFileSync(absolutePath, 'utf8');
    const trimmed = trimMiddle(raw, 9000);
    files.push({
      relPath: normalized,
      absolutePath,
      included: true,
      sha256: sha256Text(raw),
      originalChars: trimmed.originalChars,
      includedChars: trimmed.includedChars,
      truncated: trimmed.truncated,
      snippet: trimmed.text
    });
  }
  return {
    schemaVersion: 'claw.synthetic_labor_os.v3.codex_context_pack',
    generatedAt: new Date().toISOString(),
    repoRoot,
    files,
    includedFileCount: files.filter((file) => file.included).length,
    truthBoundary: 'Context pack is bounded read-only input for the remote Codex work item; it is not proof of implementation.'
  };
}

function parseJsonMaybe(text = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch {}
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch {}
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(trimmed.slice(first, last + 1)); } catch {}
  }
  return null;
}

function parseJsonl(text = '') {
  const events = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { events.push(JSON.parse(trimmed)); } catch {}
  }
  return events;
}

function collectNumericTokenFields(value, pathParts = []) {
  if (!value || typeof value !== 'object') return [];
  const found = [];
  for (const [key, entry] of Object.entries(value)) {
    const keyPath = [...pathParts, key];
    if (typeof entry === 'number' && /tokens?|token_count|input_tokens|output_tokens|total_tokens/i.test(key)) {
      found.push({ path: keyPath.join('.'), value: entry });
    } else if (entry && typeof entry === 'object') {
      found.push(...collectNumericTokenFields(entry, keyPath));
    }
  }
  return found;
}

function summarizeEvents(stdout = '') {
  const events = parseJsonl(stdout);
  const typeCounts = {};
  const tokenFields = [];
  const modelNames = new Set();
  for (const event of events) {
    const type = event.type || event.event || event.msg?.type || event.message?.type || 'unknown';
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    for (const field of collectNumericTokenFields(event)) tokenFields.push(field);
    const model = event.model || event.msg?.model || event.message?.model || event.response?.model || event.usage?.model;
    if (model) modelNames.add(String(model));
  }
  const positiveTokenValues = tokenFields.map((field) => Number(field.value)).filter((value) => Number.isFinite(value) && value > 0);
  return {
    eventCount: events.length,
    typeCounts,
    modelNames: Array.from(modelNames).sort(),
    observedTokenFields: tokenFields.slice(0, 50),
    observedPositiveTokenValueCount: positiveTokenValues.length,
    observedPositiveTokenValueTotal: positiveTokenValues.reduce((sum, value) => sum + value, 0),
    truthBoundary: 'JSONL event parsing is best-effort provenance. Absence of token fields here is not treated as provider-token proof.'
  };
}

function buildSchema({ jobId, workItem }) {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['marker', 'jobId', 'workItem', 'observedFiles', 'recommendation', 'nextActions', 'truthBoundary'],
    properties: {
      marker: { type: 'string', const: DONE_MARKER },
      jobId: { type: 'string', const: jobId },
      workItem: { type: 'string', const: workItem },
      observedFiles: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: { type: 'string' }
      },
      recommendation: { type: 'string', minLength: 20, maxLength: 1200 },
      nextActions: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: { type: 'string', minLength: 5, maxLength: 300 }
      },
      truthBoundary: { type: 'string', const: TRUTH_BOUNDARY }
    }
  };
}

function renderContextPackForPrompt(contextPack = {}) {
  return (contextPack.files || [])
    .filter((file) => file.included)
    .map((file) => [
      `--- BEGIN CONTEXT FILE: ${file.relPath} sha256=${file.sha256} truncated=${file.truncated} ---`,
      file.snippet,
      `--- END CONTEXT FILE: ${file.relPath} ---`
    ].join('\n'))
    .join('\n\n');
}

function buildPrompt({ jobId, workItem }, contextPack = {}) {
  return `You are the single remote Codex worker for Synthetic Labor OS v3.\n\nJob id: ${jobId}\nWork item: ${workItem}\n\nTask:\n- Analyze the bounded context pack below. Treat it as the repository evidence for this work item.\n- Do not modify files, do not run network commands, do not merge, do not publish, and do not send anything externally.\n- Produce the JSON object required by the provided output schema.\n- The marker must be ${DONE_MARKER}.\n- The truthBoundary must be exactly: ${TRUTH_BOUNDARY}\n- Do not say you were unable to inspect the files when the context pack includes file snippets. If context is insufficient, name the concrete missing evidence and still make the best bounded recommendation from the supplied snippets.\n\nContext pack summary: ${contextPack.includedFileCount || 0} files included.\n\n${renderContextPackForPrompt(contextPack)}\n\nThis is a bounded read-only agent work item whose output is evidence for a Synthetic Labor OS remote execution gate.`;
}

function verifyAgentOutput(agentOutput, { jobId, workItem }) {
  const failures = [];
  if (!agentOutput || typeof agentOutput !== 'object') failures.push('missing_structured_agent_output');
  if (agentOutput?.marker !== DONE_MARKER) failures.push('missing_done_marker');
  if (agentOutput?.jobId !== jobId) failures.push('job_id_mismatch');
  if (agentOutput?.workItem !== workItem) failures.push('work_item_mismatch');
  if (!Array.isArray(agentOutput?.observedFiles) || agentOutput.observedFiles.length < 1) failures.push('missing_observed_files');
  if (!String(agentOutput?.recommendation || '').trim()) failures.push('missing_recommendation');
  if (!Array.isArray(agentOutput?.nextActions) || agentOutput.nextActions.length < 1) failures.push('missing_next_actions');
  if (agentOutput?.truthBoundary !== TRUTH_BOUNDARY) failures.push('truth_boundary_mismatch');
  const outputText = [
    agentOutput?.recommendation || '',
    ...(Array.isArray(agentOutput?.nextActions) ? agentOutput.nextActions : [])
  ].join('\n');
  if (/unable to inspect|provide (?:the )?file contents|normal tool access|tool calls enabled/i.test(outputText)) {
    failures.push('agent_declined_context_inspection');
  }
  return {
    ok: failures.length === 0,
    failures,
    markerPresent: agentOutput?.marker === DONE_MARKER,
    truthBoundary: failures.length === 0
      ? 'Structured Codex output satisfied the bounded work-item contract.'
      : 'Structured Codex output is not sufficient for a completion claim.'
  };
}

function buildBlockedProof({ args, runDir, failures, startedAt, finishedAt, written = {} }) {
  return {
    schemaVersion: 'claw.synthetic_labor_os.v3.codex_agent_work_item',
    generatedAt: finishedAt,
    jobId: args.jobId,
    workItem: args.workItem,
    ok: false,
    thresholdPass: false,
    artifactDir: runDir,
    failures,
    written,
    codex: {
      binary: args.codexBin,
      exitCode: null,
      startedAt,
      finishedAt,
      durationMs: Date.parse(finishedAt) - Date.parse(startedAt)
    },
    blocker: { blockerKind: 'codex_agent_work_item_failed', blocker: `Codex agent work item failed: ${failures.join(', ')}` },
    truthBoundary: 'Blocked proof: do not claim remote Codex agent work until the Codex invocation and structured output both verify.'
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const repoRoot = path.resolve(args.repoRoot);
  const artifactRoot = path.resolve(args.artifactRoot);
  const runDir = path.join(artifactRoot, 'codex_agent', args.jobId, safeFileStamp(startedAt));
  fs.mkdirSync(runDir, { recursive: true });

  const contextPack = buildContextPack(repoRoot, args.contextFiles);
  const contextPackPath = writeJson(path.join(runDir, 'context_pack.json'), contextPack);
  const schemaPath = writeJson(path.join(runDir, 'codex_output_schema.json'), buildSchema(args));
  const promptPath = path.join(runDir, 'prompt.txt');
  fs.writeFileSync(promptPath, buildPrompt(args, contextPack));
  const lastMessagePath = path.join(runDir, 'codex_last_message.json');
  const stdoutPath = path.join(runDir, 'codex_events.jsonl');
  const stderrPath = path.join(runDir, 'codex_stderr.log');
  const proofPath = path.join(runDir, 'codex_agent_proof.json');

  const versionRun = spawnSync(args.codexBin, ['--version'], { encoding: 'utf8', timeout: 15000 });
  if (versionRun.error || versionRun.status !== 0) {
    fs.writeFileSync(stderrPath, versionRun.stderr || String(versionRun.error?.message || 'codex version check failed'));
    const proof = buildBlockedProof({
      args,
      runDir,
      failures: ['codex_binary_not_available'],
      startedAt,
      finishedAt: new Date().toISOString(),
      written: { contextPackPath, schemaPath, promptPath, stderrPath, proofPath }
    });
    writeJson(proofPath, proof);
    console.log(JSON.stringify({ ok: false, proofPath, blocker: proof.blocker, truthBoundary: proof.truthBoundary }, null, 2));
    process.exit(1);
  }

  const codexArgs = [
    'exec',
    '--json',
    '--ephemeral',
    '--sandbox', 'read-only',
    '--cd', repoRoot,
    '--skip-git-repo-check',
    '--output-schema', schemaPath,
    '--output-last-message', lastMessagePath
  ];
  if (args.model) codexArgs.push('--model', args.model);
  codexArgs.push(readText(promptPath));

  const runStarted = Date.now();
  const run = spawnSync(args.codexBin, codexArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: args.maxRuntimeMs,
    maxBuffer: 30 * 1024 * 1024,
    env: {
      ...process.env,
      PATH: `/home/jake/.local/bin:${process.env.PATH || ''}`
    }
  });
  const runFinished = Date.now();
  fs.writeFileSync(stdoutPath, run.stdout || '');
  fs.writeFileSync(stderrPath, run.stderr || (run.error ? String(run.error.message || run.error) : ''));

  const lastMessageText = readText(lastMessagePath, '');
  const agentOutput = parseJsonMaybe(lastMessageText);
  const verification = verifyAgentOutput(agentOutput, args);
  const eventSummary = summarizeEvents(run.stdout || '');
  const failures = [];
  if (run.error?.code === 'ETIMEDOUT') failures.push('codex_invocation_timed_out');
  if ((run.status ?? 1) !== 0) failures.push('codex_exit_nonzero');
  failures.push(...verification.failures);
  const ok = failures.length === 0;
  const finishedAt = new Date().toISOString();
  const proof = {
    schemaVersion: 'claw.synthetic_labor_os.v3.codex_agent_work_item',
    generatedAt: finishedAt,
    jobId: args.jobId,
    workItem: args.workItem,
    ok,
    thresholdPass: ok,
    artifactDir: runDir,
    repoRoot,
    codex: {
      binary: args.codexBin,
      version: String(versionRun.stdout || '').trim(),
      command: commandForDisplay(args.codexBin, codexArgs),
      exitCode: run.status ?? 1,
      signal: run.signal || null,
      timedOut: run.error?.code === 'ETIMEDOUT',
      startedAt: new Date(runStarted).toISOString(),
      finishedAt: new Date(runFinished).toISOString(),
      durationMs: runFinished - runStarted,
      sandbox: 'read-only',
      outputSchemaPath: schemaPath,
      outputLastMessagePath: lastMessagePath,
      stdoutJsonlPath: stdoutPath,
      stderrPath
    },
    agentOutput,
    eventSummary,
    verification,
    contextPack: {
      path: contextPackPath,
      includedFileCount: contextPack.includedFileCount,
      files: contextPack.files.map((file) => ({
        relPath: file.relPath,
        included: file.included,
        reason: file.reason || null,
        sha256: file.sha256 || null,
        originalChars: file.originalChars || null,
        includedChars: file.includedChars || null,
        truncated: file.truncated || false
      }))
    },
    failures,
    blocker: ok ? null : { blockerKind: 'codex_agent_work_item_failed', blocker: `Codex agent work item failed: ${failures.join(', ')}` },
    written: { contextPackPath, schemaPath, promptPath, lastMessagePath, stdoutPath, stderrPath, proofPath },
    truthBoundary: ok
      ? 'This proves one bounded read-only remote Codex CLI work item produced verified structured evidence. It does not prove product implementation, merge, publish, external send, or broad scale.'
      : 'Codex agent proof is red; do not claim completion until invocation and structured output verification are green.'
  };
  writeJson(proofPath, proof);
  console.log(JSON.stringify({
    ok,
    jobId: args.jobId,
    workItem: args.workItem,
    proofPath,
    codexVersion: proof.codex.version,
    codexExitCode: proof.codex.exitCode,
    verification: proof.verification,
    eventSummary: proof.eventSummary,
    truthBoundary: proof.truthBoundary
  }, null, 2));
  if (!ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
