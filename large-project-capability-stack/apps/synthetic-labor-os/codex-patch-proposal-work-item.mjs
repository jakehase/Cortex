#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DONE_MARKER = 'SLOS_CODEX_PATCH_PROPOSAL_DONE';
const TRUTH_BOUNDARY = 'Remote Codex patch proposal only; patch not applied/merged/published.';
const DEFAULT_ALLOWED_TARGETS = Object.freeze(['docs/SYNTHETIC_LABOR_OS_V4_PATCH_PROPOSAL.md']);
const DEFAULT_CONTEXT_FILES = Object.freeze([
  'docs/SYNTHETIC_LABOR_OS_V0.md',
  'apps/synthetic-labor-os/codex-patch-proposal-work-item.mjs',
  'apps/synthetic-labor-os/v4-remote-patch-pilot.mjs',
  'packages/synthetic-labor-os/index.mjs'
]);

function parseArgs(argv) {
  const args = {
    jobId: 'slos-v4-codex-patch-proposal',
    artifactRoot: 'artifacts/synthetic-labor-os-v4/latest',
    repoRoot: process.cwd(),
    codexBin: process.env.CODEX_BIN || 'codex',
    model: process.env.SYNTHETIC_LABOR_OS_CODEX_MODEL || '',
    maxRuntimeMs: Number(process.env.SYNTHETIC_LABOR_OS_CODEX_MAX_RUNTIME_MS || 120000),
    workItem: 'remote-codex-reviewable-patch-proposal',
    contextFiles: [],
    allowedTargets: []
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
    if (token === '--allowed-target') { args.allowedTargets.push(next); index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log(`usage:
  node apps/synthetic-labor-os/codex-patch-proposal-work-item.mjs --job-id JOB --artifact-root ROOT [--repo-root DIR] [--codex-bin PATH]

Runs one bounded remote Codex CLI patch-proposal work item, writes a reviewable diff artifact, verifies it with git apply --check, and exits nonzero unless the proposal is safe and review-ready. It does not apply, merge, publish, or send the patch.`);
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (!args.jobId) throw new Error('--job-id is required');
  if (!args.artifactRoot) throw new Error('--artifact-root is required');
  if (!Number.isFinite(args.maxRuntimeMs) || args.maxRuntimeMs < 1000) args.maxRuntimeMs = 120000;
  if (!args.contextFiles.length) args.contextFiles = Array.from(DEFAULT_CONTEXT_FILES);
  if (!args.allowedTargets.length) args.allowedTargets = Array.from(DEFAULT_ALLOWED_TARGETS);
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

function sha256Text(text = '') {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function sha256FileIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function commandForDisplay(command, args = []) {
  return [command, ...args].map((part) => {
    const value = String(part ?? '');
    return /[^A-Za-z0-9_./:=@+-]/.test(value) ? JSON.stringify(value) : value;
  }).join(' ');
}

function trimMiddle(value = '', maxChars = 7000) {
  const text = String(value || '');
  const limit = Math.max(1000, Number(maxChars) || 7000);
  if (text.length <= limit) return { text, truncated: false, originalChars: text.length, includedChars: text.length };
  const head = Math.floor(limit * 0.62);
  const tail = Math.max(500, limit - head - 120);
  const trimmed = `${text.slice(0, head)}\n\n...[trimmed ${text.length - head - tail} chars for bounded patch-proposal context]...\n\n${text.slice(-tail)}`;
  return { text: trimmed, truncated: true, originalChars: text.length, includedChars: trimmed.length };
}

function normalizeRelPath(relPath = '') {
  const normalized = String(relPath || '').replace(/^\/+/, '').replace(/^a\//, '').replace(/^b\//, '');
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) return null;
  return normalized;
}

function buildContextPack(repoRoot, relPaths = []) {
  const files = [];
  for (const relPath of relPaths) {
    const normalized = normalizeRelPath(relPath);
    if (!normalized) {
      files.push({ relPath, included: false, reason: 'unsafe_relative_path' });
      continue;
    }
    const absolutePath = path.join(repoRoot, normalized);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      files.push({ relPath: normalized, absolutePath, included: false, reason: 'missing_file' });
      continue;
    }
    const raw = fs.readFileSync(absolutePath, 'utf8');
    const trimmed = trimMiddle(raw);
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
    schemaVersion: 'claw.synthetic_labor_os.v4.patch_context_pack',
    generatedAt: new Date().toISOString(),
    repoRoot,
    files,
    includedFileCount: files.filter((file) => file.included).length,
    truthBoundary: 'Context pack is bounded read-only input for a remote patch proposal; it is not a patch application.'
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

function buildSchema({ jobId, workItem }) {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['marker', 'jobId', 'workItem', 'targetFiles', 'rationale', 'unifiedDiff', 'tests', 'truthBoundary'],
    properties: {
      marker: { type: 'string', const: DONE_MARKER },
      jobId: { type: 'string', const: jobId },
      workItem: { type: 'string', const: workItem },
      targetFiles: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: { type: 'string' }
      },
      rationale: { type: 'string', minLength: 20, maxLength: 1200 },
      unifiedDiff: { type: 'string', minLength: 80, maxLength: 12000 },
      tests: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        items: { type: 'string', minLength: 5, maxLength: 300 }
      },
      truthBoundary: { type: 'string', const: TRUTH_BOUNDARY }
    }
  };
}

function buildPrompt(args, contextPack = {}) {
  const targets = args.allowedTargets.join(', ');
  const primaryTarget = args.allowedTargets[0] || 'docs/SYNTHETIC_LABOR_OS_PATCH_PROPOSAL.md';
  return `You are the single remote Codex patch-proposal worker for Synthetic Labor OS v4.\n\nJob id: ${args.jobId}\nWork item: ${args.workItem}\n\nGoal:\nCreate one small reviewable unified diff proposal. Do not apply it. The only allowed target path is: ${targets}.\n\nPatch requirements:\n- The diff must be a standard unified git diff.\n- Prefer creating ${primaryTarget} as a new documentation file.\n- The file should briefly explain the reviewable patch proposal boundary: remote Codex may propose a patch, the OS dry-runs and returns it, but no apply/merge/publish occurs without a later human/operator step.\n- Include enough content that the patch is meaningful, but keep it concise.\n- Do not modify files, do not run network commands, do not merge, do not publish, and do not send anything externally.\n- Produce only the JSON object required by the output schema.\n- marker must be ${DONE_MARKER}.\n- truthBoundary must be exactly: ${TRUTH_BOUNDARY}\n\nContext pack summary: ${contextPack.includedFileCount || 0} files included.\n\n${renderContextPackForPrompt(contextPack)}\n\nThis is a bounded patch proposal. It is successful only if a verifier can write your unifiedDiff to an artifact and git apply --check accepts it without changing the worktree.`;
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
  for (const event of events) {
    const type = event.type || event.event || event.msg?.type || event.message?.type || 'unknown';
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    tokenFields.push(...collectNumericTokenFields(event));
  }
  const positiveTokenValues = tokenFields.map((field) => Number(field.value)).filter((value) => Number.isFinite(value) && value > 0);
  return {
    eventCount: events.length,
    typeCounts,
    observedTokenFields: tokenFields.slice(0, 50),
    observedPositiveTokenValueCount: positiveTokenValues.length,
    observedPositiveTokenValueTotal: positiveTokenValues.reduce((sum, value) => sum + value, 0),
    truthBoundary: 'JSONL token/event parsing is best-effort provenance from the Codex CLI event stream.'
  };
}

function extractDiffPaths(diff = '') {
  const paths = new Set();
  for (const line of String(diff || '').split(/\r?\n/)) {
    let match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match) {
      for (const candidate of [match[1], match[2]]) {
        const normalized = normalizeRelPath(candidate);
        if (normalized) paths.add(normalized);
      }
      continue;
    }
    match = line.match(/^(?:---|\+\+\+) (?:a\/|b\/)?(.+)$/);
    if (match && match[1] !== '/dev/null') {
      const normalized = normalizeRelPath(match[1]);
      if (normalized) paths.add(normalized);
    }
  }
  return Array.from(paths).sort();
}

function snapshotTargets(repoRoot, relPaths = []) {
  const snapshot = {};
  for (const relPath of relPaths) {
    const normalized = normalizeRelPath(relPath);
    if (!normalized) continue;
    const absolutePath = path.join(repoRoot, normalized);
    snapshot[normalized] = {
      exists: fs.existsSync(absolutePath),
      sha256: sha256FileIfExists(absolutePath)
    };
  }
  return snapshot;
}

function verifyPatchProposal(agentOutput, args, { repoRoot, patchPath }) {
  const failures = [];
  if (!agentOutput || typeof agentOutput !== 'object') failures.push('missing_structured_patch_output');
  if (agentOutput?.marker !== DONE_MARKER) failures.push('missing_done_marker');
  if (agentOutput?.jobId !== args.jobId) failures.push('job_id_mismatch');
  if (agentOutput?.workItem !== args.workItem) failures.push('work_item_mismatch');
  if (agentOutput?.truthBoundary !== TRUTH_BOUNDARY) failures.push('truth_boundary_mismatch');
  if (!Array.isArray(agentOutput?.targetFiles) || !agentOutput.targetFiles.length) failures.push('missing_target_files');
  if (!String(agentOutput?.rationale || '').trim()) failures.push('missing_rationale');
  if (!String(agentOutput?.unifiedDiff || '').trim()) failures.push('missing_unified_diff');
  if (!Array.isArray(agentOutput?.tests) || !agentOutput.tests.length) failures.push('missing_tests');

  const allowed = new Set(args.allowedTargets.map(normalizeRelPath).filter(Boolean));
  const targetFiles = (Array.isArray(agentOutput?.targetFiles) ? agentOutput.targetFiles : []).map(normalizeRelPath).filter(Boolean).sort();
  const diffPaths = extractDiffPaths(agentOutput?.unifiedDiff || '');
  if (!diffPaths.length) failures.push('no_paths_in_diff');
  for (const target of targetFiles) if (!allowed.has(target)) failures.push(`target_not_allowed:${target}`);
  for (const diffPath of diffPaths) if (!allowed.has(diffPath)) failures.push(`diff_path_not_allowed:${diffPath}`);
  for (const diffPath of diffPaths) if (!targetFiles.includes(diffPath)) failures.push(`diff_path_missing_from_targets:${diffPath}`);
  if (/^diff --git/m.test(agentOutput?.unifiedDiff || '') !== true) failures.push('diff_missing_git_header');

  let applyRun = { status: null, stdout: '', stderr: '', error: null, durationMs: 0 };
  const before = snapshotTargets(repoRoot, Array.from(new Set([...targetFiles, ...diffPaths, ...args.allowedTargets])));
  if (!failures.length) {
    const started = Date.now();
    const result = spawnSync('git', ['apply', '--check', '--whitespace=nowarn', patchPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 5 * 1024 * 1024
    });
    applyRun = {
      status: result.status ?? 1,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      error: result.error ? String(result.error.message || result.error) : null,
      durationMs: Date.now() - started
    };
    if (applyRun.status !== 0) failures.push('git_apply_check_failed');
  }
  const after = snapshotTargets(repoRoot, Array.from(new Set([...targetFiles, ...diffPaths, ...args.allowedTargets])));
  if (JSON.stringify(before) !== JSON.stringify(after)) failures.push('worktree_changed_during_check');

  return {
    ok: failures.length === 0,
    failures,
    targetFiles,
    diffPaths,
    allowedTargets: Array.from(allowed).sort(),
    gitApplyCheck: {
      ok: applyRun.status === 0,
      exitCode: applyRun.status,
      stdout: applyRun.stdout,
      stderr: applyRun.stderr,
      error: applyRun.error,
      durationMs: applyRun.durationMs
    },
    beforeTargetSnapshot: before,
    afterTargetSnapshot: after,
    truthBoundary: failures.length === 0
      ? 'Patch proposal is review-ready: allowed paths only, git apply --check passed, and no files were changed.'
      : 'Patch proposal is not review-ready; do not apply, merge, or claim implementation.'
  };
}

function buildBlockedProof({ args, runDir, failures, startedAt, finishedAt, written = {} }) {
  return {
    schemaVersion: 'claw.synthetic_labor_os.v4.codex_patch_proposal',
    generatedAt: finishedAt,
    jobId: args.jobId,
    workItem: args.workItem,
    ok: false,
    reviewReady: false,
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
    blocker: { blockerKind: 'codex_patch_proposal_failed', blocker: `Codex patch proposal failed: ${failures.join(', ')}` },
    truthBoundary: 'Blocked proof: do not apply, merge, publish, or claim implementation from this patch proposal.'
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const repoRoot = path.resolve(args.repoRoot);
  const artifactRoot = path.resolve(args.artifactRoot);
  const runDir = path.join(artifactRoot, 'codex_patch_proposal', args.jobId, safeFileStamp(startedAt));
  fs.mkdirSync(runDir, { recursive: true });

  const contextPack = buildContextPack(repoRoot, args.contextFiles);
  const contextPackPath = writeJson(path.join(runDir, 'context_pack.json'), contextPack);
  const schemaPath = writeJson(path.join(runDir, 'codex_patch_output_schema.json'), buildSchema(args));
  const promptPath = path.join(runDir, 'prompt.txt');
  fs.writeFileSync(promptPath, buildPrompt(args, contextPack));
  const lastMessagePath = path.join(runDir, 'codex_last_message.json');
  const stdoutPath = path.join(runDir, 'codex_events.jsonl');
  const stderrPath = path.join(runDir, 'codex_stderr.log');
  const patchPath = path.join(runDir, 'patch_proposal.diff');
  const proofPath = path.join(runDir, 'codex_patch_proposal_proof.json');

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
    maxBuffer: 40 * 1024 * 1024,
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
  if (agentOutput?.unifiedDiff) fs.writeFileSync(patchPath, agentOutput.unifiedDiff.endsWith('\n') ? agentOutput.unifiedDiff : `${agentOutput.unifiedDiff}\n`);
  else fs.writeFileSync(patchPath, '');

  const patchVerification = verifyPatchProposal(agentOutput, args, { repoRoot, patchPath });
  const eventSummary = summarizeEvents(run.stdout || '');
  const failures = [];
  if (run.error?.code === 'ETIMEDOUT') failures.push('codex_invocation_timed_out');
  if ((run.status ?? 1) !== 0) failures.push('codex_exit_nonzero');
  failures.push(...patchVerification.failures);
  const ok = failures.length === 0;
  const finishedAt = new Date().toISOString();
  const proof = {
    schemaVersion: 'claw.synthetic_labor_os.v4.codex_patch_proposal',
    generatedAt: finishedAt,
    jobId: args.jobId,
    workItem: args.workItem,
    ok,
    reviewReady: ok,
    patchApplied: false,
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
    patchProposal: {
      path: patchPath,
      sha256: sha256FileIfExists(patchPath),
      targetFiles: patchVerification.targetFiles,
      diffPaths: patchVerification.diffPaths,
      rationale: agentOutput?.rationale || null,
      tests: agentOutput?.tests || []
    },
    patchVerification,
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
    eventSummary,
    failures,
    blocker: ok ? null : { blockerKind: 'codex_patch_proposal_failed', blocker: `Codex patch proposal failed: ${failures.join(', ')}` },
    written: { contextPackPath, schemaPath, promptPath, lastMessagePath, stdoutPath, stderrPath, patchPath, proofPath },
    truthBoundary: ok
      ? 'This proves one bounded remote Codex patch proposal is review-ready: allowed paths only, git apply --check passed, artifacts returned, and the patch was not applied/merged/published.'
      : 'Patch proposal proof is red; do not apply, merge, publish, or claim implementation.'
  };
  writeJson(proofPath, proof);
  console.log(JSON.stringify({
    ok,
    reviewReady: ok,
    patchApplied: false,
    jobId: args.jobId,
    workItem: args.workItem,
    proofPath,
    patchPath,
    codexVersion: proof.codex.version,
    codexExitCode: proof.codex.exitCode,
    patchVerification: proof.patchVerification,
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
