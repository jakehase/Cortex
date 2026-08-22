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
const SUMMARY_SCHEMA = 'claw.synthetic_labor_os.v16.iteration_tournament_summary';
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
    count: 20,
    maxRuntimeMs: Number(process.env.SYNTHETIC_LABOR_OS_CODEX_MAX_RUNTIME_MS || 120000),
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
    if (token === '--count') { args.count = Number(next); index += 1; continue; }
    if (token === '--max-runtime-ms') { args.maxRuntimeMs = Number(next); index += 1; continue; }
    if (token === '--actor') { args.actor = next; index += 1; continue; }
    if (token === '--validation-command') { args.validationCommands.push(next); index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v16-iteration-tournament.mjs [--artifact-root ROOT] [--count 20]');
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

function shellQuote(value = '') {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function compact(value = new Date().toISOString()) {
  return String(value).replace(/[^0-9A-Za-z]/g, '');
}

function findRemoteSummary(returnedRoot) {
  const direct = path.join(returnedRoot, 'v16_iteration_tournament_remote_summary.json');
  if (fs.existsSync(direct)) return direct;
  const matches = [];
  function walk(dir) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === 'v16_iteration_tournament_remote_summary.json') matches.push(full);
    }
  }
  walk(returnedRoot);
  return matches[0] || null;
}

function runNode(args, { cwd, logPath }) {
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 120 * 1024 * 1024 });
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
  return { ok: (result.status ?? 1) === 0, exitCode: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '', durationMs: finished - started, logPath };
}

function parseJsonMaybe(stdout = '') {
  try { return JSON.parse(stdout); } catch { return null; }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const workspaceRoot = path.resolve(args.workspaceRoot || process.env.CLAWD_WORKSPACE_ROOT || defaultWorkspaceRoot());
  const repoPath = path.join(workspaceRoot, 'large-project-capability-stack');
  const artifactRoot = path.resolve(args.artifactRoot || 'artifacts/synthetic-labor-os-v16/latest');
  const jobId = `slos-v16-iteration-tournament-${compact(generatedAt)}`;
  const remoteArtifactRoot = args.remoteArtifactRoot || `${args.remoteRepoPath.replace(/\/+$/, '')}/artifacts/synthetic-labor-os-v16/latest`;
  const validationCommands = args.validationCommands.length ? args.validationCommands : ['node --test tests/synthetic-labor-os.test.mjs tests/synthetic-labor-os-remote-smoke.test.mjs'];
  const remoteCommand = [
    'PATH=/home/jake/.local/bin:$PATH',
    `CODEX_BIN=${shellQuote(args.codexBin)}`,
    'node apps/synthetic-labor-os/v16-iteration-worker.mjs',
    `--job-id ${shellQuote(jobId)}`,
    '--artifact-root artifacts/synthetic-labor-os-v16/latest',
    '--repo-root .',
    `--codex-bin ${shellQuote(args.codexBin)}`,
    `--count ${Math.floor(args.count)}`,
    `--max-runtime-ms ${Math.floor(args.maxRuntimeMs)}`
  ].join(' ');
  fs.mkdirSync(artifactRoot, { recursive: true });

  const job = createJob({
    id: jobId,
    createdAt: generatedAt,
    createdBy: 'synthetic-labor-os-v16-iteration-tournament',
    objective: {
      id: jobId,
      title: 'Synthetic Labor OS v16 20-iteration remote tournament',
      outcome: 'Use agent orchestration to run multiple remote Codex proposal iterations, score them, choose the best, apply only the winner, and build provenance for the selected candidate.',
      requestedFidelity: 'production_slice',
      stopCondition: '20-iteration tournament winner applied/provenanced or blocker artifact'
    },
    repoPath,
    artifactRoot,
    requestedAgentCount: 1,
    metrics: { requestedIterationCount: args.count, orchestrationWorkerCount: 1 },
    fidelity: 'production_slice',
    executionPlane: { requiredHostRole: 'execution_plane', remoteHost: args.remoteHost }
  });
  const compiled = compileJobContract(job, {
    generatedAt,
    artifactRoot,
    surfaces: ['remote_iteration_orchestration', 'candidate_scoring', 'winner_apply_gate', 'winner_provenance_chain']
  });
  const testContract = createJobTestContract({
    job: compiled,
    generatedAt,
    commands: [remoteCommand, ...validationCommands],
    expectedEvidence: ['v16_iteration_tournament_remote_summary', 'winner_apply_gate_proof', 'winner_v6_provenance_chain'],
    invariants: [
      'worker execution must run on the remote execution plane',
      'the tournament must produce the requested iteration count',
      'only one selected winner may be applied locally',
      'all non-winners remain proposals only',
      'winner approval must be target-bound and patch-sha-bound',
      'no merge, publish, deploy, or external send occurs'
    ]
  });
  const workItems = [{
    id: 'v16-remote-iteration-tournament',
    title: `Run ${args.count} remote Codex proposal iterations and return ranked candidates`,
    surfaceId: 'remote_iteration_orchestration',
    state: 'ready',
    assignedAgentId: 'remote-codex-v16-tournament-worker',
    requiredEvidence: ['v16_iteration_tournament_remote_summary', 'ranked_candidates', 'selected_best_candidate']
  }];
  const queue = createWorkQueueArtifact({ job: compiled, generatedAt, workItems });
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
  ], { cwd: repoPath, logPath: path.join(artifactRoot, 'v16_remote_dispatcher.log') });
  const dispatcherPayload = parseJsonMaybe(dispatcherRun.stdout);
  const dispatchDir = dispatcherPayload?.dispatchDir || null;
  const returnedRoot = dispatchDir ? path.join(dispatchDir, 'returned_artifacts') : null;
  const remoteSummaryPath = returnedRoot ? findRemoteSummary(returnedRoot) : null;
  const remoteSummary = readJson(remoteSummaryPath, null);
  const failures = [];
  if (!dispatcherRun.ok || dispatcherPayload?.ok !== true) failures.push('remote_dispatch_failed');
  if (remoteSummary?.ok !== true) failures.push('remote_tournament_not_green');
  if (remoteSummary?.count !== args.count) failures.push('remote_iteration_count_mismatch');
  if (!remoteSummary?.bestIteration) failures.push('missing_best_iteration');

  let winnerPatchPath = null;
  let winnerProofPath = null;
  let proposalSummaryPath = null;
  let approvalPath = null;
  let applySummaryPath = null;
  let applyPayload = null;
  let chainPayload = null;
  const best = remoteSummary?.bestIteration || null;
  if (!failures.length) {
    winnerPatchPath = path.join(returnedRoot, best.patchRelativePath);
    winnerProofPath = path.join(returnedRoot, best.proofRelativePath);
    if (!fs.existsSync(winnerPatchPath)) failures.push('winner_patch_missing_after_return');
    if (!fs.existsSync(winnerProofPath)) failures.push('winner_proof_missing_after_return');
  }
  if (!failures.length) {
    proposalSummaryPath = writeJson(path.join(artifactRoot, 'v16_winner_proposal_summary.json'), {
      schemaVersion: 'claw.synthetic_labor_os.v16.winner_proposal_summary',
      generatedAt: new Date().toISOString(),
      ok: true,
      dispatcherExitCode: dispatcherRun.exitCode,
      jobId,
      remoteDispatchOk: dispatcherPayload?.ok === true,
      patchProposalProofOk: true,
      reviewReady: true,
      patchApplied: false,
      targetFiles: [best.target],
      patchProposalPath: winnerPatchPath,
      returnedPatchProofPath: winnerProofPath,
      remoteHost: args.remoteHost,
      dispatchDir,
      selectedIteration: best.iteration,
      selectedScore: best.score.score,
      truthBoundary: 'v16 winner proposal summary covers the selected best remote Codex proposal only; it is not an apply, merge, publish, deploy, or external send.'
    });
    const patchSha256 = sha256File(winnerPatchPath);
    approvalPath = writeJson(path.join(artifactRoot, 'winner_operator_approval.json'), {
      schemaVersion: APPROVAL_SCHEMA,
      approvalId: `slos-v16-winner-approval-${compact(new Date().toISOString())}`,
      approvedAt: new Date().toISOString(),
      approved: true,
      actor: args.actor,
      approvalReason: 'User requested 20 different agent-orchestrated iterations and best-candidate selection; approval is scoped to applying only the selected winner.',
      patchPath: winnerPatchPath,
      patchSha256,
      approvedTargets: [best.target],
      approvedActions: ['git_apply_selected_winner_to_local_worktree', 'run_validation', 'write_apply_gate_proof', 'build_winner_provenance_chain'],
      prohibitedActions: ['merge', 'publish', 'deploy', 'external_send', 'broad_scale_claim'],
      truthBoundary: 'Approval is scoped to applying only the selected v16 winner patch locally and running validation. It is not approval for non-winners, merge, publish, deploy, external send, or broad product claims.'
    });
    const applyArgs = [
      path.join(SCRIPT_DIR, 'apply-patch-gate.mjs'),
      '--patch', winnerPatchPath,
      '--approval', approvalPath,
      '--artifact-root', path.join(artifactRoot, 'winner_apply_gate'),
      '--repo-root', repoPath,
      '--allowed-target', best.target,
      '--actor', 'synthetic-labor-os-v16-iteration-tournament'
    ];
    for (const command of validationCommands) applyArgs.push('--validation-command', command);
    const applyRun = runNode(applyArgs, { cwd: repoPath, logPath: path.join(artifactRoot, 'v16_winner_apply_gate.log') });
    applyPayload = parseJsonMaybe(applyRun.stdout);
    if (!applyRun.ok || applyPayload?.ok !== true) failures.push('winner_apply_gate_failed');
    const winnerApplySummary = {
      schemaVersion: 'claw.synthetic_labor_os.v16.winner_apply_summary',
      generatedAt: new Date().toISOString(),
      ok: applyRun.ok && applyPayload?.ok === true,
      gateExitCode: applyRun.exitCode,
      patchApplied: applyPayload?.patchApplied === true,
      implementationClaimAllowedForApprovedPatch: applyPayload?.implementationClaimAllowedForApprovedPatch === true,
      patchPath: winnerPatchPath,
      patchSha256,
      approvalPath,
      artifactRoot: path.join(artifactRoot, 'winner_apply_gate'),
      proofPath: applyPayload?.proofPath || null,
      summaryPath: applyPayload?.summaryPath || null,
      targetFile: path.join(repoPath, best.target),
      validationCommands,
      blocker: applyPayload?.blocker || null,
      truthBoundary: 'v16 applies only the selected approved winner patch to the local worktree and validates it. It does not apply non-winners, merge, publish, deploy, send externally, or prove broad product completeness.'
    };
    applySummaryPath = writeJson(path.join(artifactRoot, 'v16_winner_apply_summary.json'), winnerApplySummary);
  }
  if (!failures.length) {
    const chainRun = runNode([
      path.join(SCRIPT_DIR, 'v6-provenance-chain.mjs'),
      '--artifact-root', path.join(artifactRoot, 'winner_v6_chain'),
      '--repo-root', repoPath,
      '--v4-summary', proposalSummaryPath,
      '--v5-summary', applySummaryPath
    ], { cwd: repoPath, logPath: path.join(artifactRoot, 'v16_winner_v6_chain.log') });
    chainPayload = parseJsonMaybe(chainRun.stdout);
    if (!chainRun.ok || chainPayload?.ok !== true) failures.push('winner_provenance_chain_failed');
  }

  const ok = failures.length === 0;
  const summary = {
    schemaVersion: SUMMARY_SCHEMA,
    generatedAt: new Date().toISOString(),
    ok,
    status: ok ? 'green_20_iteration_tournament_winner_selected' : 'blocked',
    jobId,
    requestedIterationCount: args.count,
    remoteOkCount: remoteSummary?.okCount ?? null,
    remoteSummaryPath,
    selectedIteration: best ? {
      iteration: best.iteration,
      iterationId: best.iterationId,
      angle: best.angle,
      target: best.target,
      score: best.score.score,
      scoreDetails: best.score,
      patchPath: winnerPatchPath,
      proofPath: winnerProofPath
    } : null,
    proposalSummaryPath,
    applySummaryPath,
    chainSummaryPath: chainPayload?.summaryPath || null,
    chainPath: chainPayload?.chainPath || null,
    approvalPath,
    winnerPatchApplied: applyPayload?.patchApplied === true,
    winnerTargetExists: best ? fs.existsSync(path.join(repoPath, best.target)) : false,
    failures,
    blocker: ok ? null : { blockerKind: 'v16_iteration_tournament_failed', blocker: `v16 iteration tournament failed: ${failures.join(', ')}` },
    truthBoundary: ok
      ? 'v16 ran 20 remote Codex proposal iterations, chose the best review-ready candidate by deterministic rubric, applied only the winner through approval/apply gates, and built winner provenance. It does not merge, publish, deploy, send externally, apply non-winners, or claim unlimited autonomous labor capability.'
      : 'v16 is blocked; do not claim a selected/applied winner until remote tournament, winner apply, and provenance gates are green.'
  };
  const summaryPath = writeJson(path.join(artifactRoot, 'v16_iteration_tournament_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  if (!ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
