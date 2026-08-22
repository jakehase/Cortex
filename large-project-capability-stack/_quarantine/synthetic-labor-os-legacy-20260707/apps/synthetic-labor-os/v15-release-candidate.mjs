#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SUMMARY_SCHEMA = 'claw.synthetic_labor_os.v15.release_candidate_summary';
const REPORT_SCHEMA = 'claw.synthetic_labor_os.v15.release_candidate_report';

function parseArgs(argv) {
  const args = {
    artifactRoot: 'artifacts/synthetic-labor-os-v15/latest',
    repoRoot: process.cwd(),
    v11SummaryPath: 'artifacts/synthetic-labor-os-v11/latest/v11_release_bundle_summary.json',
    v12SummaryPath: 'artifacts/synthetic-labor-os-v12/latest/v12_fresh_replay_summary.json',
    v13SummaryPath: 'artifacts/synthetic-labor-os-v13/latest/v13_operator_doctor_summary.json',
    v14SummaryPath: 'artifacts/synthetic-labor-os-v14/latest/v14_multi_job_smoke_summary.json',
    smokeCommands: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--repo-root') { args.repoRoot = next; index += 1; continue; }
    if (token === '--v11-summary') { args.v11SummaryPath = next; index += 1; continue; }
    if (token === '--v12-summary') { args.v12SummaryPath = next; index += 1; continue; }
    if (token === '--v13-summary') { args.v13SummaryPath = next; index += 1; continue; }
    if (token === '--v14-summary') { args.v14SummaryPath = next; index += 1; continue; }
    if (token === '--smoke-command') { args.smokeCommands.push(next); index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v15-release-candidate.mjs [--artifact-root ROOT] [--smoke-command CMD]');
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (!args.smokeCommands.length) {
    args.smokeCommands = [
      'node --check apps/synthetic-labor-os/v15-release-candidate.mjs',
      'node --test tests/synthetic-labor-os.test.mjs tests/synthetic-labor-os-remote-smoke.test.mjs'
    ];
  }
  return args;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function runShell(command, { cwd, logPath }) {
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

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Synthetic Labor OS v15 Release Candidate');
  lines.push('');
  lines.push(`Status: ${report.ok ? 'green' : 'blocked'}`);
  lines.push(`RC id: ${report.releaseCandidateId}`);
  lines.push('');
  lines.push('## Evidence gates');
  for (const gate of report.evidenceGates) lines.push(`- ${gate.ok ? '✅' : '❌'} ${gate.id}: ${gate.summaryPath}`);
  lines.push('');
  lines.push('## Smoke commands');
  for (const run of report.smokeRuns) lines.push(`- ${run.ok ? '✅' : '❌'} \`${run.command}\``);
  lines.push('');
  lines.push(`Truth boundary: ${report.truthBoundary}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const repoRoot = path.resolve(args.repoRoot);
  const artifactRoot = path.resolve(args.artifactRoot);
  const summaries = [
    { id: 'v11_release_bundle', path: path.resolve(args.v11SummaryPath), json: readJson(path.resolve(args.v11SummaryPath), null), requiredStatus: 'green_release_bundle' },
    { id: 'v12_fresh_replay', path: path.resolve(args.v12SummaryPath), json: readJson(path.resolve(args.v12SummaryPath), null), requiredStatus: 'green_fresh_remote_replay' },
    { id: 'v13_operator_doctor', path: path.resolve(args.v13SummaryPath), json: readJson(path.resolve(args.v13SummaryPath), null), requiredStatus: 'green_operator_doctor' },
    { id: 'v14_multi_job_smoke', path: path.resolve(args.v14SummaryPath), json: readJson(path.resolve(args.v14SummaryPath), null), requiredStatus: 'green_multi_job_workload_smoke' }
  ];
  const evidenceGates = summaries.map((entry) => ({
    id: entry.id,
    ok: entry.json?.ok === true && (!entry.requiredStatus || entry.json?.status === entry.requiredStatus),
    summaryPath: entry.path,
    status: entry.json?.status || null,
    blocker: entry.json?.blocker || null
  }));
  const smokeRuns = args.smokeCommands.map((command, index) => runShell(command, {
    cwd: repoRoot,
    logPath: path.join(artifactRoot, `smoke-${String(index + 1).padStart(2, '0')}.log`)
  }));
  const failures = [];
  for (const gate of evidenceGates) if (!gate.ok) failures.push(`evidence_gate_not_green:${gate.id}`);
  for (const [index, run] of smokeRuns.entries()) if (!run.ok) failures.push(`smoke_command_failed:${index + 1}`);
  const ok = failures.length === 0;
  const report = {
    schemaVersion: REPORT_SCHEMA,
    generatedAt,
    ok,
    status: ok ? 'green_release_candidate' : 'blocked',
    releaseCandidateId: `slos-v15-rc-${generatedAt.replace(/[^0-9A-Za-z]/g, '')}`,
    repoRoot,
    evidenceGates,
    smokeRuns,
    failures,
    blocker: ok ? null : { blockerKind: 'v15_release_candidate_failed', blocker: `v15 release candidate failed: ${failures.join(', ')}` },
    truthBoundary: ok
      ? 'v15 is a green internal release-candidate gate for the SLOS production slice through v14. It does not merge, publish, deploy, send externally, or claim unlimited autonomous labor capability.'
      : 'v15 is blocked; do not treat the SLOS production slice as release-candidate green until all evidence and smoke gates pass.'
  };
  const reportPath = writeJson(path.join(artifactRoot, 'v15_release_candidate_report.json'), report);
  const markdownPath = path.join(artifactRoot, 'v15_release_candidate_report.md');
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(markdownPath, renderMarkdown(report));
  const summary = {
    schemaVersion: SUMMARY_SCHEMA,
    generatedAt,
    ok,
    status: report.status,
    releaseCandidateId: report.releaseCandidateId,
    reportPath,
    markdownPath,
    evidenceGateCount: evidenceGates.length,
    greenEvidenceGateCount: evidenceGates.filter((gate) => gate.ok).length,
    smokeCommandCount: smokeRuns.length,
    greenSmokeCommandCount: smokeRuns.filter((run) => run.ok).length,
    blocker: report.blocker,
    truthBoundary: report.truthBoundary
  };
  const summaryPath = writeJson(path.join(artifactRoot, 'v15_release_candidate_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  if (!ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
