#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SUMMARY_SCHEMA = 'claw.synthetic_labor_os.v16.iteration_tournament_remote_summary';
const ANGLES = Object.freeze([
  'operator handoff clarity',
  'fresh replay repeatability',
  'approval boundary precision',
  'multi-job conflict handling',
  'release-candidate confidence',
  'artifact checksum auditability',
  'remote execution-plane proof',
  'rollback dry-run readiness',
  'tamper-case failure clarity',
  'operator runbook usability',
  'provenance chain explainability',
  'scale-smoke boundary honesty',
  'config validation ergonomics',
  'review-ready patch discipline',
  'bounded product-claim wording',
  'worker evidence completeness',
  'best-candidate selection rationale',
  'fresh target uniqueness',
  'validation log discoverability',
  'release bundle portability'
]);

function parseArgs(argv) {
  const args = {
    jobId: 'slos-v16-iteration-tournament',
    artifactRoot: 'artifacts/synthetic-labor-os-v16/latest',
    repoRoot: process.cwd(),
    codexBin: process.env.CODEX_BIN || 'codex',
    count: 20,
    maxRuntimeMs: Number(process.env.SYNTHETIC_LABOR_OS_CODEX_MAX_RUNTIME_MS || 120000),
    targetPrefix: null,
    contextFiles: ['docs/SYNTHETIC_LABOR_OS_V0.md']
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--job-id') { args.jobId = next; index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--repo-root') { args.repoRoot = next; index += 1; continue; }
    if (token === '--codex-bin') { args.codexBin = next; index += 1; continue; }
    if (token === '--count') { args.count = Number(next); index += 1; continue; }
    if (token === '--max-runtime-ms') { args.maxRuntimeMs = Number(next); index += 1; continue; }
    if (token === '--target-prefix') { args.targetPrefix = next; index += 1; continue; }
    if (token === '--context-file') { args.contextFiles.push(next); index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v16-iteration-worker.mjs --job-id JOB --artifact-root ROOT [--count 20]');
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (!Number.isFinite(args.count) || args.count < 1) args.count = 20;
  if (!Number.isFinite(args.maxRuntimeMs) || args.maxRuntimeMs < 1000) args.maxRuntimeMs = 120000;
  return args;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function compact(value = new Date().toISOString()) {
  return String(value).replace(/[^0-9A-Za-z]/g, '');
}

function relPath(root, filePath) {
  if (!filePath) return null;
  const relative = path.relative(root, filePath);
  return relative && !relative.startsWith('..') ? relative : null;
}

function parseJsonMaybe(stdout = '') {
  try { return JSON.parse(stdout); } catch { return null; }
}

function runIteration({ args, iteration, target, angle, runDir }) {
  const iterationId = `${args.jobId}-iteration-${String(iteration).padStart(2, '0')}`;
  const commandArgs = [
    path.join(SCRIPT_DIR, 'codex-patch-proposal-work-item.mjs'),
    '--job-id', iterationId,
    '--work-item', `remote-codex-v16-tournament-iteration-${iteration}-${angle.replace(/[^a-z0-9]+/gi, '-')}`,
    '--artifact-root', path.join(args.artifactRoot, 'iterations'),
    '--repo-root', args.repoRoot,
    '--codex-bin', args.codexBin,
    '--max-runtime-ms', String(args.maxRuntimeMs),
    '--allowed-target', target
  ];
  for (const contextFile of args.contextFiles) commandArgs.push('--context-file', contextFile);
  const started = Date.now();
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: args.repoRoot,
    encoding: 'utf8',
    maxBuffer: 80 * 1024 * 1024
  });
  const finished = Date.now();
  const logPath = path.join(runDir, `iteration-${String(iteration).padStart(2, '0')}.log`);
  fs.writeFileSync(logPath, [
    `$ ${process.execPath} ${commandArgs.join(' ')}`,
    `cwd: ${args.repoRoot}`,
    `exitCode: ${result.status ?? 1}`,
    `signal: ${result.signal || ''}`,
    `durationMs: ${finished - started}`,
    '',
    '--- stdout ---',
    result.stdout || '',
    '--- stderr ---',
    result.stderr || '',
    ''
  ].join('\n'));
  const payload = parseJsonMaybe(result.stdout);
  const proof = readJson(payload?.proofPath, null);
  const patchText = payload?.patchPath && fs.existsSync(payload.patchPath) ? fs.readFileSync(payload.patchPath, 'utf8') : '';
  const score = scoreIteration({ exitCode: result.status ?? 1, payload, proof, target, patchText });
  return {
    iteration,
    iterationId,
    angle,
    target,
    ok: (result.status ?? 1) === 0 && payload?.ok === true && proof?.ok === true,
    exitCode: result.status ?? 1,
    durationMs: finished - started,
    payload,
    proofPath: payload?.proofPath || null,
    proofRelativePath: relPath(args.artifactRoot, payload?.proofPath || ''),
    patchPath: payload?.patchPath || null,
    patchRelativePath: relPath(args.artifactRoot, payload?.patchPath || ''),
    logPath,
    logRelativePath: relPath(args.artifactRoot, logPath),
    score,
    failures: proof?.failures || (payload?.blocker ? [payload.blocker.blockerKind || 'payload_blocked'] : [])
  };
}

function uniqueLineCount(text = '') {
  return new Set(String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)).size;
}

function scoreIteration({ exitCode, payload, proof, target, patchText = '' }) {
  const failures = [];
  if (exitCode !== 0) failures.push('exit_nonzero');
  if (payload?.ok !== true) failures.push('payload_not_ok');
  if (proof?.ok !== true) failures.push('proof_not_ok');
  if (proof?.reviewReady !== true) failures.push('not_review_ready');
  if (proof?.patchApplied !== false) failures.push('patch_was_applied');
  if (proof?.patchVerification?.gitApplyCheck?.ok !== true) failures.push('git_apply_check_not_ok');
  const targets = proof?.patchProposal?.targetFiles || [];
  if (JSON.stringify(targets) !== JSON.stringify([target])) failures.push('target_mismatch');
  const diff = proof?.patchProposal?.unifiedDiff || patchText || '';
  const rationale = proof?.patchProposal?.rationale || '';
  const tests = proof?.patchProposal?.tests || [];
  const diffLines = String(diff || '').split(/\r?\n/).filter(Boolean).length;
  const uniqueLines = uniqueLineCount(diff);
  const positiveTokens = Number(proof?.eventSummary?.observedPositiveTokenValueTotal || 0);
  const score = failures.length ? 0 : Math.round(
    1000
    + Math.min(220, diffLines * 6)
    + Math.min(160, uniqueLines * 8)
    + Math.min(140, String(rationale).length / 4)
    + Math.min(80, tests.length * 20)
    + Math.min(120, positiveTokens / 200)
  );
  return {
    score,
    failures,
    diffLines,
    uniqueLines,
    rationaleChars: String(rationale).length,
    testCount: tests.length,
    observedPositiveTokenValueTotal: positiveTokens,
    rubric: 'Review-ready required. Then score favors concise-but-substantive diff, unique lines, rationale detail, declared tests, and token-observed real worker evidence.'
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  args.repoRoot = path.resolve(args.repoRoot);
  args.artifactRoot = path.resolve(args.artifactRoot);
  const generatedAt = new Date().toISOString();
  const runDir = path.join(args.artifactRoot, 'tournament_logs');
  fs.mkdirSync(runDir, { recursive: true });
  const stamp = compact(generatedAt);
  const targetPrefix = args.targetPrefix || `docs/SYNTHETIC_LABOR_OS_V16_ITERATION_${stamp}_`;
  const iterations = [];
  for (let iteration = 1; iteration <= args.count; iteration += 1) {
    const target = `${targetPrefix}${String(iteration).padStart(2, '0')}.md`;
    const angle = ANGLES[(iteration - 1) % ANGLES.length];
    iterations.push(runIteration({ args, iteration, target, angle, runDir }));
  }
  const ranked = iterations.slice().sort((a, b) => b.score.score - a.score.score || a.iteration - b.iteration);
  const best = ranked.find((entry) => entry.ok && entry.score.score > 0) || null;
  const failures = [];
  if (iterations.length !== args.count) failures.push('iteration_count_mismatch');
  if (!best) failures.push('no_review_ready_iteration');
  const okCount = iterations.filter((entry) => entry.ok).length;
  if (okCount < 1) failures.push('no_green_iterations');
  const ok = failures.length === 0;
  const summary = {
    schemaVersion: SUMMARY_SCHEMA,
    generatedAt,
    ok,
    status: ok ? 'green_remote_iteration_tournament' : 'blocked',
    jobId: args.jobId,
    count: args.count,
    okCount,
    bestIteration: best,
    rankedIterations: ranked.map((entry) => ({
      iteration: entry.iteration,
      iterationId: entry.iterationId,
      angle: entry.angle,
      target: entry.target,
      ok: entry.ok,
      score: entry.score.score,
      scoreDetails: entry.score,
      proofRelativePath: entry.proofRelativePath,
      patchRelativePath: entry.patchRelativePath,
      logRelativePath: entry.logRelativePath,
      failures: entry.failures
    })),
    iterations,
    failures,
    blocker: ok ? null : { blockerKind: 'v16_iteration_tournament_failed', blocker: `v16 iteration tournament failed: ${failures.join(', ')}` },
    truthBoundary: ok
      ? 'v16 remote worker produced and scored multiple review-ready patch proposals. It did not apply, merge, publish, deploy, or send externally; local selection/apply remains a separate gate.'
      : 'v16 remote worker did not produce a selectable green iteration; do not apply or claim a best candidate.'
  };
  const summaryPath = writeJson(path.join(args.artifactRoot, 'v16_iteration_tournament_remote_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  if (!ok) process.exitCode = 1;
}

export { scoreIteration };

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
