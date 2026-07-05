#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APPROVAL_SCHEMA = 'claw.synthetic_labor_os.v5.patch_apply_approval';

function defaultWorkspaceRoot() {
  const cwd = process.cwd();
  if (path.basename(cwd) === 'large-project-capability-stack') return path.resolve(cwd, '..');
  return cwd;
}

function parseArgs(argv) {
  const args = {
    artifactRoot: null,
    workspaceRoot: null,
    patchPath: null,
    actor: 'Jake',
    approvalReason: 'User said Do it after the v5 operator review/apply gate recommendation.',
    validationCommands: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--workspace-root') { args.workspaceRoot = next; index += 1; continue; }
    if (token === '--patch') { args.patchPath = next; index += 1; continue; }
    if (token === '--actor') { args.actor = next; index += 1; continue; }
    if (token === '--approval-reason') { args.approvalReason = next; index += 1; continue; }
    if (token === '--validation-command') { args.validationCommands.push(next); index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v5-apply-pilot.mjs [--artifact-root ROOT] [--patch PATCH] [--actor ACTOR] [--validation-command CMD]');
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
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function derivePatchPathFromV4(repoPath) {
  const summaryPath = path.join(repoPath, 'artifacts/synthetic-labor-os-v4/latest/v4_remote_patch_pilot_summary.json');
  const summary = readJson(summaryPath, null);
  if (!summary?.returnedPatchProofPath) return null;
  return path.join(path.dirname(summary.returnedPatchProofPath), 'patch_proposal.diff');
}

function runMain() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceRoot = path.resolve(args.workspaceRoot || process.env.CLAWD_WORKSPACE_ROOT || defaultWorkspaceRoot());
  const repoPath = path.join(workspaceRoot, 'large-project-capability-stack');
  const artifactRoot = path.resolve(args.artifactRoot || 'artifacts/synthetic-labor-os-v5/latest');
  const generatedAt = new Date().toISOString();
  const patchPath = path.resolve(args.patchPath || derivePatchPathFromV4(repoPath) || '');
  if (!patchPath || !fs.existsSync(patchPath)) throw new Error(`patch path not found: ${patchPath || '(none)'}`);
  const patchSha256 = sha256File(patchPath);
  const approval = {
    schemaVersion: APPROVAL_SCHEMA,
    approvalId: `slos-v5-approval-${generatedAt.replace(/[^0-9A-Za-z]/g, '')}`,
    approvedAt: generatedAt,
    approved: true,
    actor: args.actor,
    approvalReason: args.approvalReason,
    patchPath,
    patchSha256,
    approvedTargets: ['docs/SYNTHETIC_LABOR_OS_V4_PATCH_PROPOSAL.md'],
    approvedActions: ['git_apply_to_local_worktree', 'run_validation', 'write_apply_gate_proof'],
    prohibitedActions: ['merge', 'publish', 'deploy', 'external_send', 'broad_scale_claim'],
    truthBoundary: 'Approval is scoped to applying the returned v4 docs patch to the local worktree and running validation. It is not merge, publish, deploy, external-send, or broad product approval.'
  };
  const approvalPath = writeJson(path.join(artifactRoot, 'operator_approval.json'), approval);
  const validationCommands = args.validationCommands.length
    ? args.validationCommands
    : ['node --test tests/synthetic-labor-os.test.mjs tests/synthetic-labor-os-remote-smoke.test.mjs'];
  const gateCli = path.join(repoPath, 'apps/synthetic-labor-os/apply-patch-gate.mjs');
  const gateArgs = [
    gateCli,
    '--patch', patchPath,
    '--approval', approvalPath,
    '--artifact-root', artifactRoot,
    '--repo-root', repoPath,
    '--allowed-target', 'docs/SYNTHETIC_LABOR_OS_V4_PATCH_PROPOSAL.md',
    '--actor', 'synthetic-labor-os-v5-apply-pilot'
  ];
  for (const command of validationCommands) gateArgs.push('--validation-command', command);
  const run = spawnSync(process.execPath, gateArgs, {
    cwd: repoPath,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024
  });
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.writeFileSync(path.join(artifactRoot, 'v5_apply_gate.stdout.json'), run.stdout || '');
  fs.writeFileSync(path.join(artifactRoot, 'v5_apply_gate.stderr.log'), run.stderr || '');
  const gatePayload = run.stdout ? JSON.parse(run.stdout) : null;
  const summary = {
    schemaVersion: 'claw.synthetic_labor_os.v5.apply_pilot_summary',
    generatedAt: new Date().toISOString(),
    ok: run.status === 0 && gatePayload?.ok === true,
    gateExitCode: run.status,
    patchApplied: gatePayload?.patchApplied === true,
    implementationClaimAllowedForApprovedPatch: gatePayload?.implementationClaimAllowedForApprovedPatch === true,
    patchPath,
    patchSha256,
    approvalPath,
    artifactRoot,
    proofPath: gatePayload?.proofPath || null,
    summaryPath: gatePayload?.summaryPath || null,
    targetFile: path.join(repoPath, 'docs/SYNTHETIC_LABOR_OS_V4_PATCH_PROPOSAL.md'),
    validationCommands,
    blocker: gatePayload?.blocker || null,
    truthBoundary: 'v5 applies one approved docs patch to the local worktree and validates it. It does not merge, publish, deploy, send externally, or prove broad product completeness.'
  };
  writeJson(path.join(artifactRoot, 'v5_apply_pilot_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, gatePayload }, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { runMain(); }
  catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  }
}
