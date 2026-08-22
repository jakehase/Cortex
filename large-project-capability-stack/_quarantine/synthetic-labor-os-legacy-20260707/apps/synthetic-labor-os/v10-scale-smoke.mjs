#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SUMMARY_SCHEMA = 'claw.synthetic_labor_os.v10.scale_smoke_summary';
const PROOF_SCHEMA = 'claw.synthetic_labor_os.v10.scale_smoke_proof';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    artifactRoot: 'artifacts/synthetic-labor-os-v10/latest',
    repoRoot: process.cwd(),
    v0MatrixPath: 'artifacts/synthetic-labor-os-v0/latest/capability_matrix.json',
    v4SummaryPath: 'artifacts/synthetic-labor-os-v4/latest/v4_remote_patch_pilot_summary.json',
    v5SummaryPath: 'artifacts/synthetic-labor-os-v5/latest/v5_apply_pilot_summary.json',
    smokeCommands: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--repo-root') { args.repoRoot = next; index += 1; continue; }
    if (token === '--v0-matrix') { args.v0MatrixPath = next; index += 1; continue; }
    if (token === '--v4-summary') { args.v4SummaryPath = next; index += 1; continue; }
    if (token === '--v5-summary') { args.v5SummaryPath = next; index += 1; continue; }
    if (token === '--smoke-command') { args.smokeCommands.push(next); index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v10-scale-smoke.mjs [--artifact-root ROOT] [--smoke-command CMD]');
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (!args.smokeCommands.length) {
    args.smokeCommands = [
      'node --check apps/synthetic-labor-os/v10-scale-smoke.mjs',
      'node --test tests/synthetic-labor-os.test.mjs tests/synthetic-labor-os-remote-smoke.test.mjs'
    ];
  }
  return args;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function runNodeLogged(commandArgs, { cwd, logPath }) {
  const started = Date.now();
  const result = spawnSync(process.execPath, commandArgs, { cwd, encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 });
  const finished = Date.now();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, [
    `$ ${process.execPath} ${commandArgs.join(' ')}`,
    `cwd: ${cwd}`,
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
  return { ok: (result.status ?? 1) === 0, exitCode: result.status ?? 1, signal: result.signal || null, durationMs: finished - started, stdout: result.stdout || '', stderr: result.stderr || '', logPath };
}

function runShellLogged(command, { cwd, logPath }) {
  const started = Date.now();
  const result = spawnSync(command, { cwd, shell: true, encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 });
  const finished = Date.now();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, [
    `$ ${command}`,
    `cwd: ${cwd}`,
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
  return {
    command,
    ok: (result.status ?? 1) === 0,
    exitCode: result.status ?? 1,
    signal: result.signal || null,
    durationMs: finished - started,
    stdoutBytes: Buffer.byteLength(result.stdout || ''),
    stderrBytes: Buffer.byteLength(result.stderr || ''),
    logPath
  };
}

function parseStdoutJson(run) {
  try { return JSON.parse(run.stdout); }
  catch { return null; }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const repoRoot = path.resolve(args.repoRoot);
  const artifactRoot = path.resolve(args.artifactRoot);
  const failures = [];

  const v8ArtifactRoot = path.join(artifactRoot, 'embedded_v8');
  const v8Run = runNodeLogged([
    path.join(SCRIPT_DIR, 'v8-e2e-demo.mjs'),
    '--artifact-root', v8ArtifactRoot,
    '--repo-root', repoRoot,
    '--v4-summary', path.resolve(args.v4SummaryPath),
    '--v5-summary', path.resolve(args.v5SummaryPath)
  ], { cwd: repoRoot, logPath: path.join(artifactRoot, 'v8_e2e_demo.log') });
  const v8Payload = parseStdoutJson(v8Run);
  if (!v8Run.ok || v8Payload?.ok !== true) failures.push('v8_e2e_demo_not_green');

  const v9ArtifactRoot = path.join(artifactRoot, 'embedded_v9');
  const v9Run = v8Payload?.ok === true ? runNodeLogged([
    path.join(SCRIPT_DIR, 'v9-finished-claim-report.mjs'),
    '--artifact-root', v9ArtifactRoot,
    '--repo-root', repoRoot,
    '--v0-matrix', path.resolve(args.v0MatrixPath),
    '--v6-summary', v8Payload.v6SummaryPath,
    '--v7-summary', v8Payload.v7SummaryPath,
    '--v8-summary', v8Payload.summaryPath
  ], { cwd: repoRoot, logPath: path.join(artifactRoot, 'v9_finished_claim_report.log') }) : null;
  const v9Payload = v9Run ? parseStdoutJson(v9Run) : null;
  if (!v9Run || !v9Run.ok || v9Payload?.ok !== true || v9Payload?.finishedClaimAllowed !== true) failures.push('v9_finished_claim_report_not_green');

  const smokeRuns = args.smokeCommands.map((command, index) => runShellLogged(command, {
    cwd: repoRoot,
    logPath: path.join(artifactRoot, `smoke-${String(index + 1).padStart(2, '0')}.log`)
  }));
  if (!smokeRuns.length) failures.push('missing_smoke_commands');
  smokeRuns.forEach((run, index) => { if (!run.ok) failures.push(`smoke_command_failed:${index + 1}`); });

  const ok = failures.length === 0;
  const proof = {
    schemaVersion: PROOF_SCHEMA,
    generatedAt,
    ok,
    status: ok ? 'green_v10_finished_for_bounded_sequence' : 'blocked',
    repoRoot,
    gates: {
      v8E2eDemo: { ok: v8Payload?.ok === true, summaryPath: v8Payload?.summaryPath || null, tracePath: v8Payload?.tracePath || null, logPath: v8Run.logPath },
      v9FinishedClaimReport: { ok: v9Payload?.ok === true && v9Payload?.finishedClaimAllowed === true, summaryPath: v9Payload?.summaryPath || null, reportPath: v9Payload?.reportPath || null, markdownPath: v9Payload?.markdownPath || null, logPath: v9Run?.logPath || null },
      smokeCommands: smokeRuns
    },
    finishedForBoundedV10Sequence: ok,
    failures,
    blocker: ok ? null : { blockerKind: 'v10_scale_smoke_failed', blocker: `v10 scale smoke failed: ${failures.join(', ')}` },
    truthBoundary: ok
      ? 'v10 is green for the bounded Synthetic Labor OS v0 productization sequence: evidence lineage, hardening checks, one-command E2E demo, finished-claim report, and local smoke commands passed. It does not merge, publish, deploy, send externally, or prove unlimited/full autonomous labor capability.'
      : 'v10 is blocked; do not claim the bounded sequence finished until all gates and smoke commands are green.'
  };
  const proofPath = writeJson(path.join(artifactRoot, 'v10_scale_smoke_proof.json'), proof);
  const summary = {
    schemaVersion: SUMMARY_SCHEMA,
    generatedAt,
    ok,
    status: proof.status,
    finishedForBoundedV10Sequence: proof.finishedForBoundedV10Sequence,
    proofPath,
    v8SummaryPath: v8Payload?.summaryPath || null,
    v9SummaryPath: v9Payload?.summaryPath || null,
    smokeCommandCount: smokeRuns.length,
    greenSmokeCommandCount: smokeRuns.filter((run) => run.ok).length,
    blocker: proof.blocker,
    truthBoundary: proof.truthBoundary
  };
  const summaryPath = writeJson(path.join(artifactRoot, 'v10_scale_smoke_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  if (!ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
