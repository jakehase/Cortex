#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SUMMARY_SCHEMA = 'claw.synthetic_labor_os.v8.e2e_demo_summary';
const TRACE_SCHEMA = 'claw.synthetic_labor_os.v8.e2e_demo_trace';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    artifactRoot: 'artifacts/synthetic-labor-os-v8/latest',
    repoRoot: process.cwd(),
    v4SummaryPath: 'artifacts/synthetic-labor-os-v4/latest/v4_remote_patch_pilot_summary.json',
    v5SummaryPath: 'artifacts/synthetic-labor-os-v5/latest/v5_apply_pilot_summary.json',
    sourceMode: 'existing_green_artifacts'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--repo-root') { args.repoRoot = next; index += 1; continue; }
    if (token === '--v4-summary') { args.v4SummaryPath = next; index += 1; continue; }
    if (token === '--v5-summary') { args.v5SummaryPath = next; index += 1; continue; }
    if (token === '--source-mode') { args.sourceMode = next; index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v8-e2e-demo.mjs [--artifact-root ROOT] [--v4-summary PATH] [--v5-summary PATH]');
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
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

function runLogged(commandArgs, { cwd, logPath }) {
  const started = Date.now();
  const result = spawnSync(process.execPath, commandArgs, { cwd, encoding: 'utf8', maxBuffer: 60 * 1024 * 1024 });
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
  return {
    ok: (result.status ?? 1) === 0,
    exitCode: result.status ?? 1,
    signal: result.signal || null,
    durationMs: finished - started,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
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
  const v4SummaryPath = path.resolve(args.v4SummaryPath);
  const v5SummaryPath = path.resolve(args.v5SummaryPath);
  const v4Summary = readJson(v4SummaryPath, null);
  const v5Summary = readJson(v5SummaryPath, null);
  const failures = [];

  if (args.sourceMode !== 'existing_green_artifacts') failures.push(`unsupported_source_mode:${args.sourceMode}`);
  if (v4Summary?.ok !== true || v4Summary?.reviewReady !== true || v4Summary?.patchApplied !== false) failures.push('v4_source_artifact_not_green_review_ready');
  if (v5Summary?.ok !== true || v5Summary?.patchApplied !== true || v5Summary?.implementationClaimAllowedForApprovedPatch !== true) failures.push('v5_source_artifact_not_green_applied');

  const v6ArtifactRoot = path.join(artifactRoot, 'embedded_v6');
  const v7ArtifactRoot = path.join(artifactRoot, 'embedded_v7');
  const v6Run = failures.length ? null : runLogged([
    path.join(SCRIPT_DIR, 'v6-provenance-chain.mjs'),
    '--artifact-root', v6ArtifactRoot,
    '--repo-root', repoRoot,
    '--v4-summary', v4SummaryPath,
    '--v5-summary', v5SummaryPath
  ], { cwd: repoRoot, logPath: path.join(artifactRoot, 'v6_provenance_chain.log') });
  const v6Payload = v6Run ? parseStdoutJson(v6Run) : null;
  if (v6Run && !v6Run.ok) failures.push('embedded_v6_chain_failed');
  if (v6Payload?.ok !== true) failures.push('embedded_v6_summary_not_green');

  const v7Run = failures.length ? null : runLogged([
    path.join(SCRIPT_DIR, 'v7-replay-rollback-audit.mjs'),
    '--artifact-root', v7ArtifactRoot,
    '--repo-root', repoRoot,
    '--chain', path.join(v6ArtifactRoot, 'v6_provenance_chain.json')
  ], { cwd: repoRoot, logPath: path.join(artifactRoot, 'v7_replay_rollback_audit.log') });
  const v7Payload = v7Run ? parseStdoutJson(v7Run) : null;
  if (v7Run && !v7Run.ok) failures.push('embedded_v7_replay_rollback_failed');
  if (v7Payload?.ok !== true) failures.push('embedded_v7_summary_not_green');

  const steps = [
    {
      id: 'objective',
      ok: true,
      description: 'Operator objective is represented as a bounded production_slice: prove one remote Codex patch can move through review, apply, provenance, and hardening gates.'
    },
    {
      id: 'remote_codex_patch_proposal',
      ok: v4Summary?.ok === true && v4Summary?.reviewReady === true && v4Summary?.patchApplied === false,
      artifact: v4SummaryPath,
      remoteHost: v4Summary?.remoteHost || null,
      truthBoundary: 'Existing v4 artifact is used as the real remote proposal proof; v8 does not launch a new remote Codex call by default.'
    },
    {
      id: 'operator_approval_and_apply',
      ok: v5Summary?.ok === true && v5Summary?.patchApplied === true,
      artifact: v5SummaryPath,
      approvalPath: v5Summary?.approvalPath || null
    },
    {
      id: 'provenance_chain',
      ok: v6Payload?.ok === true,
      artifact: v6Payload?.chainPath || null,
      summaryPath: v6Payload?.summaryPath || null
    },
    {
      id: 'replay_rollback_tamper_hardening',
      ok: v7Payload?.ok === true,
      artifact: v7Payload?.proofPath || null,
      summaryPath: v7Payload?.summaryPath || null
    }
  ];
  for (const step of steps) if (!step.ok) failures.push(`step_not_green:${step.id}`);

  const ok = failures.length === 0;
  const trace = {
    schemaVersion: TRACE_SCHEMA,
    generatedAt,
    ok,
    sourceMode: args.sourceMode,
    repoRoot,
    steps,
    embeddedRuns: {
      v6: { ok: v6Run?.ok === true, logPath: v6Run?.logPath || null, summaryPath: v6Payload?.summaryPath || null, chainPath: v6Payload?.chainPath || null },
      v7: { ok: v7Run?.ok === true, logPath: v7Run?.logPath || null, summaryPath: v7Payload?.summaryPath || null, proofPath: v7Payload?.proofPath || null }
    },
    failures,
    blocker: ok ? null : { blockerKind: 'v8_e2e_demo_failed', blocker: `v8 E2E demo failed: ${failures.join(', ')}` },
    truthBoundary: ok
      ? 'v8 packages an end-to-end demonstration over existing green v4/v5 real artifacts and fresh v6/v7 verification. It does not launch new remote work, merge, publish, deploy, or send externally.'
      : 'v8 is blocked; do not claim one-command E2E readiness until every demo step is green.'
  };
  const tracePath = writeJson(path.join(artifactRoot, 'v8_e2e_demo_trace.json'), trace);
  const summary = {
    schemaVersion: SUMMARY_SCHEMA,
    generatedAt,
    ok,
    status: ok ? 'green_one_command_e2e_demo' : 'blocked',
    sourceMode: args.sourceMode,
    tracePath,
    v6SummaryPath: v6Payload?.summaryPath || null,
    v6ChainPath: v6Payload?.chainPath || null,
    v7SummaryPath: v7Payload?.summaryPath || null,
    v7ProofPath: v7Payload?.proofPath || null,
    greenStepCount: steps.filter((step) => step.ok).length,
    stepCount: steps.length,
    blocker: trace.blocker,
    truthBoundary: trace.truthBoundary
  };
  const summaryPath = writeJson(path.join(artifactRoot, 'v8_e2e_demo_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  if (!ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
