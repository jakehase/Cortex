#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  compileJobContract,
  createJob,
  createJobTestContract,
  createWorkQueueArtifact,
  queueJob,
  writeSyntheticLaborOsJob
} from '../../packages/synthetic-labor-os/index.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SUMMARY_SCHEMA = 'claw.synthetic_labor_os.v12.fresh_replay_summary';
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
    remoteHost: process.env.SYNTHETIC_LABOR_OS_REMOTE_HOST || 'jake@37.27.129.239',
    remoteRepoPath: process.env.SYNTHETIC_LABOR_OS_REMOTE_REPO || '/home/jake/clawd-remote/large-project-capability-stack',
    remoteArtifactRoot: null,
    codexBin: process.env.CODEX_BIN || '/home/jake/.local/bin/codex',
    maxRuntimeMs: Number(process.env.SYNTHETIC_LABOR_OS_CODEX_MAX_RUNTIME_MS || 120000),
    target: null,
    actor: 'Jake',
    validationCommands: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--workspace-root') { args.workspaceRoot = next; index += 1; continue; }
    if (token === '--remote' || token === '--remote-host') { args.remoteHost = next; index += 1; continue; }
    if (token === '--remote-repo') { args.remoteRepoPath = next; index += 1; continue; }
    if (token === '--remote-artifact-root') { args.remoteArtifactRoot = next; index += 1; continue; }
    if (token === '--codex-bin') { args.codexBin = next; index += 1; continue; }
    if (token === '--max-runtime-ms') { args.maxRuntimeMs = Number(next); index += 1; continue; }
    if (token === '--target') { args.target = next; index += 1; continue; }
    if (token === '--actor') { args.actor = next; index += 1; continue; }
    if (token === '--validation-command') { args.validationCommands.push(next); index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v12-fresh-replay.mjs [--artifact-root ROOT] [--target docs/file.md]');
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (!Number.isFinite(args.maxRuntimeMs) || args.maxRuntimeMs < 1000) args.maxRuntimeMs = 120000;
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

function shellQuote(value = '') {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function compact(value = new Date().toISOString()) {
  return String(value).replace(/[^0-9A-Za-z]/g, '');
}

function normalizeRelPath(relPath = '') {
  const normalized = String(relPath || '').replace(/^\/+/, '').replace(/^a\//, '').replace(/^b\//, '');
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) return null;
  return normalized;
}

function findNewestProof(root) {
  const matches = [];
  function walk(dir) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === 'codex_patch_proposal_proof.json') {
        const stat = fs.statSync(full);
        matches.push({ path: full, mtimeMs: stat.mtimeMs });
      }
    }
  }
  walk(root);
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0]?.path || null;
}

function runNode(args, { cwd, logPath }) {
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 });
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const workspaceRoot = path.resolve(args.workspaceRoot || process.env.CLAWD_WORKSPACE_ROOT || defaultWorkspaceRoot());
  const repoPath = path.join(workspaceRoot, 'large-project-capability-stack');
  const artifactRoot = path.resolve(args.artifactRoot || 'artifacts/synthetic-labor-os-v12/latest');
  const jobId = `slos-v12-fresh-replay-${compact(generatedAt)}`;
  const target = normalizeRelPath(args.target || `docs/SYNTHETIC_LABOR_OS_V12_FRESH_REPLAY_${compact(generatedAt)}.md`);
  if (!target) throw new Error(`invalid --target: ${args.target}`);
  if (fs.existsSync(path.join(repoPath, target))) throw new Error(`fresh replay target already exists: ${target}`);
  const remoteArtifactRoot = args.remoteArtifactRoot || `${args.remoteRepoPath.replace(/\/+$/, '')}/artifacts/synthetic-labor-os-v12/latest`;
  const validationCommands = args.validationCommands.length ? args.validationCommands : ['node --test tests/synthetic-labor-os.test.mjs tests/synthetic-labor-os-remote-smoke.test.mjs'];
  fs.mkdirSync(artifactRoot, { recursive: true });

  const remoteCommand = [
    'PATH=/home/jake/.local/bin:$PATH',
    `CODEX_BIN=${shellQuote(args.codexBin)}`,
    'node apps/synthetic-labor-os/codex-patch-proposal-work-item.mjs',
    `--job-id ${shellQuote(jobId)}`,
    '--work-item remote-codex-fresh-replay-patch-proposal',
    '--artifact-root artifacts/synthetic-labor-os-v12/latest',
    '--repo-root .',
    `--codex-bin ${shellQuote(args.codexBin)}`,
    `--max-runtime-ms ${Math.floor(args.maxRuntimeMs)}`,
    `--allowed-target ${shellQuote(target)}`,
    '--context-file docs/SYNTHETIC_LABOR_OS_V0.md'
  ].join(' ');

  const job = createJob({
    id: jobId,
    createdAt: generatedAt,
    createdBy: 'synthetic-labor-os-v12-fresh-replay',
    objective: {
      id: jobId,
      title: 'Synthetic Labor OS v12 fresh replay',
      outcome: 'Prove the v4-v10 path can start from fresh inputs by dispatching a new remote Codex proposal, approving/applying it, and rebuilding provenance over the new artifacts.',
      requestedFidelity: 'production_slice',
      stopCondition: 'fresh proposal/apply/provenance green or blocker artifact'
    },
    repoPath,
    artifactRoot,
    requestedAgentCount: 1,
    fidelity: 'production_slice',
    executionPlane: { requiredHostRole: 'execution_plane', remoteHost: args.remoteHost }
  });
  const compiled = compileJobContract(job, {
    generatedAt,
    artifactRoot,
    surfaces: ['fresh_remote_codex_patch', 'fresh_operator_approval', 'fresh_apply_gate', 'fresh_provenance_chain']
  });
  const testContract = createJobTestContract({
    job: compiled,
    generatedAt,
    commands: [remoteCommand, ...validationCommands],
    expectedEvidence: ['remote_dispatch_result', 'codex_patch_proposal_proof', 'patch_apply_gate_proof', 'v6_provenance_chain'],
    invariants: [
      'target path must not exist before the replay starts',
      'remote proposal must run on the execution plane',
      'the proposal patch must touch only the fresh target',
      'approval must be target-bound and patch-sha-bound',
      'apply gate must change the fresh target and pass validation',
      'fresh replay does not merge, publish, deploy, or send externally'
    ]
  });
  const queue = createWorkQueueArtifact({
    job: compiled,
    generatedAt,
    workItems: [{ id: 'v12-fresh-remote-proposal', title: 'Run fresh remote Codex proposal', surfaceId: 'fresh_remote_codex_patch', state: 'ready', assignedAgentId: 'remote-codex-fresh-agent-1' }]
  });
  const queued = queueJob({ ...compiled, artifacts: { ...compiled.artifacts, testContract } }, { generatedAt, queue });
  const { jobPath } = writeSyntheticLaborOsJob({ job: queued, jobsDir: path.join(artifactRoot, 'jobs') });

  const dispatcherRun = runNode([
    path.join(SCRIPT_DIR, 'remote-dispatcher.mjs'),
    '--job', jobPath,
    '--artifact-root', artifactRoot,
    '--local-repo', repoPath,
    '--remote', args.remoteHost,
    '--remote-repo', args.remoteRepoPath,
    '--remote-artifact-root', remoteArtifactRoot,
    '--command', remoteCommand
  ], { cwd: repoPath, logPath: path.join(artifactRoot, 'v12_remote_dispatcher.log') });
  const dispatcherPayload = parseJsonMaybe(dispatcherRun.stdout);
  const dispatchDir = dispatcherPayload?.dispatchDir || null;
  const returnedRoot = dispatchDir ? path.join(dispatchDir, 'returned_artifacts') : null;
  const patchProofPath = returnedRoot ? findNewestProof(returnedRoot) : null;
  const patchProof = readJson(patchProofPath, null);
  const patchPath = patchProofPath ? path.join(path.dirname(patchProofPath), 'patch_proposal.diff') : null;
  const proposalSummary = {
    schemaVersion: 'claw.synthetic_labor_os.v12.fresh_remote_patch_proposal_summary',
    generatedAt: new Date().toISOString(),
    ok: dispatcherRun.ok && dispatcherPayload?.ok === true && patchProof?.ok === true,
    dispatcherExitCode: dispatcherRun.exitCode,
    jobId,
    remoteDispatchOk: dispatcherPayload?.ok === true,
    patchProposalProofOk: patchProof?.ok === true,
    reviewReady: patchProof?.reviewReady === true,
    patchApplied: patchProof?.patchApplied === true,
    targetFiles: patchProof?.patchProposal?.targetFiles || [],
    patchProposalPath: patchPath,
    returnedPatchProofPath: patchProofPath,
    remoteHost: args.remoteHost,
    dispatchDir,
    truthBoundary: 'v12 proposal summary covers one fresh remote Codex patch proposal; the proposal itself is not an apply, merge, publish, deploy, or external send.'
  };
  const proposalSummaryPath = writeJson(path.join(artifactRoot, 'v12_fresh_proposal_summary.json'), proposalSummary);

  const failures = [];
  if (!dispatcherRun.ok || dispatcherPayload?.ok !== true) failures.push('remote_dispatch_failed');
  if (patchProof?.ok !== true || patchProof?.reviewReady !== true) failures.push('fresh_patch_proposal_not_green');
  if (patchProof?.patchApplied !== false) failures.push('proposal_stage_applied_patch');
  if (!patchPath || !fs.existsSync(patchPath)) failures.push('missing_returned_patch');
  if (JSON.stringify((patchProof?.patchProposal?.targetFiles || []).sort()) !== JSON.stringify([target])) failures.push('proposal_target_mismatch');

  let approvalPath = null;
  let applyPayload = null;
  let applySummaryPath = null;
  let chainPayload = null;
  if (!failures.length) {
    const patchSha256 = sha256File(patchPath);
    approvalPath = writeJson(path.join(artifactRoot, 'operator_approval.json'), {
      schemaVersion: APPROVAL_SCHEMA,
      approvalId: `slos-v12-approval-${compact(new Date().toISOString())}`,
      approvedAt: new Date().toISOString(),
      approved: true,
      actor: args.actor,
      approvalReason: 'User said Let’s do it after v12-v15 fresh production-slice recommendation.',
      patchPath,
      patchSha256,
      approvedTargets: [target],
      approvedActions: ['git_apply_to_local_worktree', 'run_validation', 'write_apply_gate_proof', 'build_fresh_provenance_chain'],
      prohibitedActions: ['merge', 'publish', 'deploy', 'external_send', 'broad_scale_claim'],
      truthBoundary: 'Approval is scoped to applying the returned v12 fresh replay docs patch to the local worktree and running validation. It is not merge, publish, deploy, external-send, or broad product approval.'
    });
    const applyArgs = [
      path.join(SCRIPT_DIR, 'apply-patch-gate.mjs'),
      '--patch', patchPath,
      '--approval', approvalPath,
      '--artifact-root', path.join(artifactRoot, 'apply_gate'),
      '--repo-root', repoPath,
      '--allowed-target', target,
      '--actor', 'synthetic-labor-os-v12-fresh-replay'
    ];
    for (const command of validationCommands) applyArgs.push('--validation-command', command);
    const applyRun = runNode(applyArgs, { cwd: repoPath, logPath: path.join(artifactRoot, 'v12_apply_gate.log') });
    applyPayload = parseJsonMaybe(applyRun.stdout);
    if (!applyRun.ok || applyPayload?.ok !== true) failures.push('fresh_apply_gate_failed');
    const applySummary = {
      schemaVersion: 'claw.synthetic_labor_os.v12.fresh_apply_summary',
      generatedAt: new Date().toISOString(),
      ok: applyRun.ok && applyPayload?.ok === true,
      gateExitCode: applyRun.exitCode,
      patchApplied: applyPayload?.patchApplied === true,
      implementationClaimAllowedForApprovedPatch: applyPayload?.implementationClaimAllowedForApprovedPatch === true,
      patchPath,
      patchSha256,
      approvalPath,
      artifactRoot: path.join(artifactRoot, 'apply_gate'),
      proofPath: applyPayload?.proofPath || null,
      summaryPath: applyPayload?.summaryPath || null,
      targetFile: path.join(repoPath, target),
      validationCommands,
      blocker: applyPayload?.blocker || null,
      truthBoundary: 'v12 applies one fresh approved docs patch to the local worktree and validates it. It does not merge, publish, deploy, send externally, or prove broad product completeness.'
    };
    applySummaryPath = writeJson(path.join(artifactRoot, 'v12_fresh_apply_summary.json'), applySummary);
  }

  if (!failures.length) {
    const chainRun = runNode([
      path.join(SCRIPT_DIR, 'v6-provenance-chain.mjs'),
      '--artifact-root', path.join(artifactRoot, 'fresh_v6_chain'),
      '--repo-root', repoPath,
      '--v4-summary', proposalSummaryPath,
      '--v5-summary', applySummaryPath
    ], { cwd: repoPath, logPath: path.join(artifactRoot, 'v12_fresh_v6_chain.log') });
    chainPayload = parseJsonMaybe(chainRun.stdout);
    if (!chainRun.ok || chainPayload?.ok !== true) failures.push('fresh_provenance_chain_failed');
  }

  const ok = failures.length === 0;
  const summary = {
    schemaVersion: SUMMARY_SCHEMA,
    generatedAt: new Date().toISOString(),
    ok,
    status: ok ? 'green_fresh_remote_replay' : 'blocked',
    jobId,
    target,
    remoteHost: args.remoteHost,
    proposalSummaryPath,
    applySummaryPath,
    chainSummaryPath: chainPayload?.summaryPath || null,
    chainPath: chainPayload?.chainPath || null,
    patchPath,
    approvalPath,
    patchApplied: applyPayload?.patchApplied === true,
    freshTargetExists: fs.existsSync(path.join(repoPath, target)),
    failures,
    blocker: ok ? null : { blockerKind: 'v12_fresh_replay_failed', blocker: `v12 fresh replay failed: ${failures.join(', ')}` },
    truthBoundary: ok
      ? 'v12 proves the SLOS proposal→approval→apply→provenance path can run fresh with a new remote Codex proposal target. It does not merge, publish, deploy, send externally, or prove unlimited autonomous labor capability.'
      : 'v12 is blocked; do not claim fresh replay readiness until remote proposal, apply gate, and provenance chain are green.'
  };
  const summaryPath = writeJson(path.join(artifactRoot, 'v12_fresh_replay_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  if (!ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
