#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SUMMARY_SCHEMA = 'claw.synthetic_labor_os.v14.multi_job_smoke_summary';
const PROOF_SCHEMA = 'claw.synthetic_labor_os.v14.multi_job_smoke_proof';
const APPROVAL_SCHEMA = 'claw.synthetic_labor_os.v5.patch_apply_approval';

function parseArgs(argv) {
  const args = {
    artifactRoot: 'artifacts/synthetic-labor-os-v14/latest',
    repoRoot: process.cwd()
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--repo-root') { args.repoRoot = next; index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v14-multi-job-smoke.mjs [--artifact-root ROOT]');
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
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

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function run(command, args, { cwd }) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

function runNode(args, { cwd, logPath }) {
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  const finished = Date.now();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, [
    `$ ${process.execPath} ${args.join(' ')}`,
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
  return { ok: (result.status ?? 1) === 0, exitCode: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '', logPath, durationMs: finished - started };
}

function parseJsonMaybe(stdout = '') {
  try { return JSON.parse(stdout); } catch { return null; }
}

function patchFor(relPath, title, body) {
  return [
    `diff --git a/${relPath} b/${relPath}`,
    'new file mode 100644',
    'index 0000000..1111111',
    '--- /dev/null',
    `+++ b/${relPath}`,
    '@@ -0,0 +1,3 @@',
    `+# ${title}`,
    '+',
    `+${body}`
  ].join('\n') + '\n';
}

function writeApproval({ artifactRoot, jobId, patchPath, target }) {
  const patchSha256 = sha256File(patchPath);
  return writeJson(path.join(artifactRoot, `${jobId}.approval.json`), {
    schemaVersion: APPROVAL_SCHEMA,
    approvalId: `${jobId}-approval`,
    approvedAt: new Date().toISOString(),
    approved: true,
    actor: 'synthetic-labor-os-v14-multi-job-smoke',
    approvalReason: `v14 isolated multi-job smoke approval for ${target}`,
    patchPath,
    patchSha256,
    approvedTargets: [target],
    approvedActions: ['git_apply_to_isolated_smoke_repo', 'run_validation', 'write_apply_gate_proof'],
    prohibitedActions: ['merge', 'publish', 'deploy', 'external_send', 'broad_scale_claim'],
    truthBoundary: 'Approval is scoped to an isolated v14 smoke repository only.'
  });
}

function runApplyGate({ repoRoot, artifactRoot, jobId, patchPath, approvalPath, target, expectOk }) {
  const runResult = runNode([
    path.join(SCRIPT_DIR, 'apply-patch-gate.mjs'),
    '--patch', patchPath,
    '--approval', approvalPath,
    '--artifact-root', path.join(artifactRoot, jobId),
    '--repo-root', repoRoot,
    '--allowed-target', target,
    '--validation-command', `test -f ${target}`,
    '--actor', `synthetic-labor-os-v14-${jobId}`
  ], { cwd: repoRoot, logPath: path.join(artifactRoot, `${jobId}.log`) });
  const payload = parseJsonMaybe(runResult.stdout);
  const proof = readJson(payload?.proofPath, null);
  return {
    jobId,
    target,
    expectOk,
    ok: runResult.ok,
    exitCode: runResult.exitCode,
    payload,
    proofPath: payload?.proofPath || null,
    failures: proof?.failures || [],
    changedTargets: proof?.targetSnapshots?.changedTargets || [],
    logPath: runResult.logPath
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const artifactRoot = path.resolve(args.artifactRoot);
  const smokeRepo = path.join(artifactRoot, 'isolated_smoke_repo');
  fs.rmSync(smokeRepo, { recursive: true, force: true });
  fs.mkdirSync(path.join(smokeRepo, 'docs'), { recursive: true });
  const init = run('git', ['init', '-q'], { cwd: smokeRepo });
  if ((init.status ?? 1) !== 0) throw new Error(`git init failed: ${init.stderr || init.stdout}`);
  fs.writeFileSync(path.join(smokeRepo, 'docs/README.md'), '# v14 isolated smoke repo\n');

  const patchesDir = path.join(artifactRoot, 'patches');
  fs.mkdirSync(patchesDir, { recursive: true });
  const jobs = [
    { jobId: 'job-a', target: 'docs/v14-job-a.md', patchText: patchFor('docs/v14-job-a.md', 'v14 job A', 'First approved smoke job.') },
    { jobId: 'job-b', target: 'docs/v14-job-b.md', patchText: patchFor('docs/v14-job-b.md', 'v14 job B', 'Second approved smoke job.') },
    { jobId: 'job-conflict-a', target: 'docs/v14-job-a.md', patchText: patchFor('docs/v14-job-a.md', 'v14 conflicting job A', 'Conflicting job should be blocked after job A applies.'), expectBlocked: true }
  ];

  const jobResults = [];
  for (const job of jobs) {
    const patchPath = path.join(patchesDir, `${job.jobId}.diff`);
    fs.writeFileSync(patchPath, job.patchText);
    const approvalPath = writeApproval({ artifactRoot, jobId: job.jobId, patchPath, target: job.target });
    const result = runApplyGate({
      repoRoot: smokeRepo,
      artifactRoot,
      jobId: job.jobId,
      patchPath,
      approvalPath,
      target: job.target,
      expectOk: !job.expectBlocked
    });
    jobResults.push(result);
  }

  const appliedJobs = jobResults.filter((job) => job.expectOk && job.ok);
  const blockedConflicts = jobResults.filter((job) => !job.expectOk && !job.ok && job.failures.includes('git_apply_check_failed'));
  const failures = [];
  if (appliedJobs.length !== 2) failures.push('expected_two_applied_jobs');
  if (blockedConflicts.length !== 1) failures.push('expected_one_conflict_blocked');
  for (const relPath of ['docs/v14-job-a.md', 'docs/v14-job-b.md']) {
    if (!fs.existsSync(path.join(smokeRepo, relPath))) failures.push(`missing_applied_target:${relPath}`);
  }
  if (fs.readFileSync(path.join(smokeRepo, 'docs/v14-job-a.md'), 'utf8').includes('Conflicting')) failures.push('conflict_patch_overwrote_applied_file');

  const ok = failures.length === 0;
  const proof = {
    schemaVersion: PROOF_SCHEMA,
    generatedAt,
    ok,
    status: ok ? 'green_multi_job_workload_smoke' : 'blocked',
    smokeRepo,
    jobResults,
    appliedJobCount: appliedJobs.length,
    blockedConflictCount: blockedConflicts.length,
    failures,
    blocker: ok ? null : { blockerKind: 'v14_multi_job_smoke_failed', blocker: `v14 multi-job smoke failed: ${failures.join(', ')}` },
    truthBoundary: ok
      ? 'v14 proves an isolated multi-job workload can apply two approved jobs and fail closed on a conflicting third job. It does not merge, publish, deploy, or send externally.'
      : 'v14 is blocked; do not claim multi-job workload readiness until applied and conflict paths are green.'
  };
  const proofPath = writeJson(path.join(artifactRoot, 'v14_multi_job_smoke_proof.json'), proof);
  const summary = {
    schemaVersion: SUMMARY_SCHEMA,
    generatedAt,
    ok,
    status: proof.status,
    proofPath,
    appliedJobCount: proof.appliedJobCount,
    blockedConflictCount: proof.blockedConflictCount,
    smokeRepo,
    blocker: proof.blocker,
    truthBoundary: proof.truthBoundary
  };
  const summaryPath = writeJson(path.join(artifactRoot, 'v14_multi_job_smoke_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  if (!ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
