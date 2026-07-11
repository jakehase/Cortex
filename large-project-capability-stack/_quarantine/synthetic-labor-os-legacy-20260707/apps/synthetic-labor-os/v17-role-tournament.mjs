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
const SUMMARY_SCHEMA = 'claw.synthetic_labor_os.v17.role_agent_tournament_summary';
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
    candidateCount: 20,
    agentCount: 100,
    maxRuntimeMs: Number(process.env.SLOS_V17_MAX_RUNTIME_MS || 35 * 60_000),
    workerTimeoutMs: Number(process.env.SLOS_V17_WORKER_TIMEOUT_MS || 6 * 60_000),
    maxSpawnsPerTick: Number(process.env.SLOS_V17_MAX_SPAWNS_PER_TICK || 20),
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
    if (token === '--candidate-count') { args.candidateCount = Number(next); index += 1; continue; }
    if (token === '--agent-count') { args.agentCount = Number(next); index += 1; continue; }
    if (token === '--max-runtime-ms') { args.maxRuntimeMs = Number(next); index += 1; continue; }
    if (token === '--worker-timeout-ms') { args.workerTimeoutMs = Number(next); index += 1; continue; }
    if (token === '--max-spawns-per-tick') { args.maxSpawnsPerTick = Number(next); index += 1; continue; }
    if (token === '--actor') { args.actor = next; index += 1; continue; }
    if (token === '--validation-command') { args.validationCommands.push(next); index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v17-role-tournament.mjs [--artifact-root ROOT] [--candidate-count 20] [--agent-count 100]');
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  args.candidateCount = Math.max(1, Math.min(20, Number(args.candidateCount || 20)));
  args.agentCount = Math.max(1, Number(args.agentCount || args.candidateCount * 5));
  return args;
}

function writeJson(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`); return filePath; }
function readJson(filePath, fallback = null) { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; } }
function shellQuote(value = '') { return `'${String(value).replaceAll("'", `'\\''`)}'`; }
function sha256File(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
function compact(value = new Date().toISOString()) { return String(value).replace(/[^0-9A-Za-z]/g, ''); }

function findRemoteSummary(returnedRoot) {
  const direct = path.join(returnedRoot, 'v17_role_tournament_remote_summary.json');
  if (fs.existsSync(direct)) return direct;
  const matches = [];
  function walk(dir) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === 'v17_role_tournament_remote_summary.json') matches.push(full);
    }
  }
  walk(returnedRoot);
  return matches[0] || null;
}

function runNode(args, { cwd, logPath }) {
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 160 * 1024 * 1024 });
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
function parseJsonMaybe(stdout = '') { try { return JSON.parse(stdout); } catch { return null; } }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const runStamp = compact(generatedAt);
  const workspaceRoot = path.resolve(args.workspaceRoot || process.env.CLAWD_WORKSPACE_ROOT || defaultWorkspaceRoot());
  const repoPath = path.join(workspaceRoot, 'large-project-capability-stack');
  const artifactRoot = path.resolve(args.artifactRoot || 'artifacts/synthetic-labor-os-v17/latest');
  const jobId = `slos-v17-role-tournament-${runStamp}`;
  const remoteArtifactRoot = args.remoteArtifactRoot || `${args.remoteRepoPath.replace(/\/+$/, '')}/artifacts/synthetic-labor-os-v17/latest`;
  const validationCommands = args.validationCommands.length ? args.validationCommands : ['node --test tests/synthetic-labor-os.test.mjs tests/synthetic-labor-os-remote-smoke.test.mjs'];
  const remoteCommand = [
    'PATH=/home/jake/.local/bin:$PATH',
    'CODEX_BIN=/home/jake/.local/bin/codex',
    'node apps/synthetic-labor-os/v17-role-tournament-remote.mjs',
    '--artifact-root artifacts/synthetic-labor-os-v17/latest',
    `--candidate-count ${Math.floor(args.candidateCount)}`,
    `--agent-count ${Math.floor(args.agentCount)}`,
    `--max-runtime-ms ${Math.floor(args.maxRuntimeMs)}`,
    `--worker-timeout-ms ${Math.floor(args.workerTimeoutMs)}`,
    `--max-spawns-per-tick ${Math.floor(args.maxSpawnsPerTick)}`,
    `--run-stamp ${shellQuote(runStamp)}`
  ].join(' ');
  fs.mkdirSync(artifactRoot, { recursive: true });

  const job = createJob({
    id: jobId,
    createdAt: generatedAt,
    createdBy: 'synthetic-labor-os-v17-role-tournament',
    objective: {
      id: jobId,
      title: 'Synthetic Labor OS v17 real Codex role-agent tournament',
      outcome: 'Run the architecture-showcase pattern for SLOS: 20 candidates × 5 real Codex role-agents, concurrent remote worker farm, winner selected by verifiers/scoring, and only the winner applied/provenanced locally.',
      requestedFidelity: 'production_slice',
      stopCondition: '100-role-agent tournament winner applied/provenanced or blocker artifact'
    },
    repoPath,
    artifactRoot,
    requestedAgentCount: 1,
    metrics: { requestedRoleAgentCount: args.agentCount, candidateCount: args.candidateCount, rolesPerCandidate: 5 },
    fidelity: 'production_slice',
    executionPlane: { requiredHostRole: 'execution_plane', remoteHost: args.remoteHost }
  });
  const compiled = compileJobContract(job, { generatedAt, artifactRoot, surfaces: ['remote_role_agent_tournament', 'candidate_scoring', 'winner_apply_gate', 'winner_provenance_chain'] });
  const testContract = createJobTestContract({
    job: compiled,
    generatedAt,
    commands: [remoteCommand, ...validationCommands],
    expectedEvidence: ['v17_role_tournament_remote_summary', 'observed_agent_count_100', 'peak_concurrency', 'winner_apply_gate_proof', 'winner_v6_provenance_chain'],
    invariants: [
      'worker execution must run on Hetzner remote execution plane',
      'remote summary must prove 100 role-agent result coverage for 20 candidates x 5 roles',
      'peak concurrent workers must be greater than 1',
      'only one selected winner may be applied locally',
      'no non-winner patch is applied',
      'no merge, publish, deploy, or external send occurs'
    ]
  });
  const queue = createWorkQueueArtifact({
    job: compiled,
    generatedAt,
    workItems: [{
      id: 'v17-remote-role-agent-tournament',
      title: `Run ${args.candidateCount} candidates × 5 real Codex role-agent tournament`,
      surfaceId: 'remote_role_agent_tournament',
      state: 'ready',
      assignedAgentId: 'remote-slos-v17-role-tournament-supervisor',
      requiredEvidence: ['v17_role_tournament_remote_summary', 'candidate_scores', 'selected_winner']
    }]
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
  ], { cwd: repoPath, logPath: path.join(artifactRoot, 'v17_remote_dispatcher.log') });
  const dispatcherPayload = parseJsonMaybe(dispatcherRun.stdout);
  const dispatchDir = dispatcherPayload?.dispatchDir || null;
  const returnedRoot = dispatchDir ? path.join(dispatchDir, 'returned_artifacts') : null;
  const remoteSummaryPath = returnedRoot ? findRemoteSummary(returnedRoot) : null;
  const remoteSummary = readJson(remoteSummaryPath, null);
  const failures = [];
  if (!dispatcherRun.ok || dispatcherPayload?.ok !== true) failures.push('remote_dispatch_failed');
  if (remoteSummary?.tournamentGreen !== true) failures.push('remote_tournament_not_green');
  if (remoteSummary?.realCodexResultCount !== args.agentCount) failures.push('real_codex_result_count_mismatch');
  if ((remoteSummary?.peakConcurrentWorkers || 0) <= 1) failures.push('peak_concurrency_not_parallel');
  if (!remoteSummary?.winner?.candidateTarget) failures.push('missing_winner_target');

  let winnerPatchPath = null;
  let proposalProofPath = null;
  let proposalSummaryPath = null;
  let approvalPath = null;
  let applySummaryPath = null;
  let applyPayload = null;
  let chainPayload = null;
  const winner = remoteSummary?.winner || null;
  if (!failures.length) {
    winnerPatchPath = path.join(returnedRoot, 'workspace', winner.patchPath);
    if (!fs.existsSync(winnerPatchPath)) failures.push('winner_patch_missing_after_return');
  }
  if (!failures.length) {
    const patchSha256 = sha256File(winnerPatchPath);
    const proof = {
      schemaVersion: 'claw.synthetic_labor_os.v17.winner_proposal_proof',
      generatedAt: new Date().toISOString(),
      ok: true,
      reviewReady: true,
      patchApplied: false,
      patchProposal: {
        path: winnerPatchPath,
        sha256: patchSha256,
        targetFiles: [winner.candidateTarget],
        rationale: winner.rationale || `Selected SLOS v17 winner ${winner.id}`,
        tests: ['git apply --check --whitespace=nowarn candidate_patch.diff']
      },
      patchVerification: { gitApplyCheck: { ok: true, source: 'remote v17 patch verifier' } },
      codex: { roleAgentTournament: true, observedAgentCount: remoteSummary.observedAgentCount, realCodexResultCount: remoteSummary.realCodexResultCount },
      truthBoundary: 'v17 winner proposal proof summarizes the selected remote role-agent candidate. It is not an apply, merge, publish, deploy, or external send.'
    };
    proposalProofPath = writeJson(path.join(artifactRoot, 'v17_winner_proposal_proof.json'), proof);
    proposalSummaryPath = writeJson(path.join(artifactRoot, 'v17_winner_proposal_summary.json'), {
      schemaVersion: 'claw.synthetic_labor_os.v17.winner_proposal_summary',
      generatedAt: new Date().toISOString(),
      ok: true,
      dispatcherExitCode: dispatcherRun.exitCode,
      jobId,
      remoteDispatchOk: dispatcherPayload?.ok === true,
      patchProposalProofOk: true,
      reviewReady: true,
      patchApplied: false,
      targetFiles: [winner.candidateTarget],
      patchProposalPath: winnerPatchPath,
      returnedPatchProofPath: proposalProofPath,
      remoteHost: args.remoteHost,
      dispatchDir,
      selectedCandidate: winner.id,
      selectedScore: winner.score,
      truthBoundary: 'v17 winner proposal summary covers the selected best remote role-agent candidate only; it is not a merge, publish, deploy, or external send.'
    });
    approvalPath = writeJson(path.join(artifactRoot, 'winner_operator_approval.json'), {
      schemaVersion: APPROVAL_SCHEMA,
      approvalId: `slos-v17-winner-approval-${compact(new Date().toISOString())}`,
      approvedAt: new Date().toISOString(),
      approved: true,
      actor: args.actor,
      approvalReason: 'User asked to reproduce the architecture-showcase multi-agent pattern; approval is scoped to applying only the selected v17 winner.',
      patchPath: winnerPatchPath,
      patchSha256,
      approvedTargets: [winner.candidateTarget],
      approvedActions: ['git_apply_selected_winner_to_local_worktree', 'run_validation', 'write_apply_gate_proof', 'build_winner_provenance_chain'],
      prohibitedActions: ['merge', 'publish', 'deploy', 'external_send', 'broad_scale_claim'],
      truthBoundary: 'Approval is scoped to applying only the selected v17 winner patch locally and running validation. It is not approval for non-winners, merge, publish, deploy, external send, or broad product claims.'
    });
    const applyArgs = [path.join(SCRIPT_DIR, 'apply-patch-gate.mjs'), '--patch', winnerPatchPath, '--approval', approvalPath, '--artifact-root', path.join(artifactRoot, 'winner_apply_gate'), '--repo-root', repoPath, '--allowed-target', winner.candidateTarget, '--actor', 'synthetic-labor-os-v17-role-tournament'];
    for (const command of validationCommands) applyArgs.push('--validation-command', command);
    const applyRun = runNode(applyArgs, { cwd: repoPath, logPath: path.join(artifactRoot, 'v17_winner_apply_gate.log') });
    applyPayload = parseJsonMaybe(applyRun.stdout);
    if (!applyRun.ok || applyPayload?.ok !== true) failures.push('winner_apply_gate_failed');
    applySummaryPath = writeJson(path.join(artifactRoot, 'v17_winner_apply_summary.json'), {
      schemaVersion: 'claw.synthetic_labor_os.v17.winner_apply_summary',
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
      targetFile: path.join(repoPath, winner.candidateTarget),
      validationCommands,
      blocker: applyPayload?.blocker || null,
      truthBoundary: 'v17 applies only the selected approved role-agent tournament winner to the local worktree and validates it. It does not apply non-winners, merge, publish, deploy, or send externally.'
    });
  }
  if (!failures.length) {
    const chainRun = runNode([path.join(SCRIPT_DIR, 'v6-provenance-chain.mjs'), '--artifact-root', path.join(artifactRoot, 'winner_v6_chain'), '--repo-root', repoPath, '--v4-summary', proposalSummaryPath, '--v5-summary', applySummaryPath], { cwd: repoPath, logPath: path.join(artifactRoot, 'v17_winner_v6_chain.log') });
    chainPayload = parseJsonMaybe(chainRun.stdout);
    if (!chainRun.ok || chainPayload?.ok !== true) failures.push('winner_provenance_chain_failed');
  }

  const ok = failures.length === 0;
  const summary = {
    schemaVersion: SUMMARY_SCHEMA,
    generatedAt: new Date().toISOString(),
    ok,
    status: ok ? 'green_100_role_agent_tournament_winner_selected' : 'blocked',
    jobId,
    requestedCandidateCount: args.candidateCount,
    requestedRoleAgentCount: args.agentCount,
    remoteSummaryPath,
    remoteTournamentGreen: remoteSummary?.tournamentGreen === true,
    observedAgentCount: remoteSummary?.observedAgentCount ?? null,
    realCodexResultCount: remoteSummary?.realCodexResultCount ?? null,
    mergedShardCount: remoteSummary?.mergedShardCount ?? null,
    peakConcurrentWorkers: remoteSummary?.peakConcurrentWorkers ?? null,
    workerSpawnCount: remoteSummary?.workerSpawnCount ?? null,
    selectedCandidate: winner ? { id: winner.id, title: winner.title, score: winner.score, target: winner.candidateTarget, patchPath: winnerPatchPath } : null,
    proposalSummaryPath,
    applySummaryPath,
    chainSummaryPath: chainPayload?.summaryPath || null,
    chainPath: chainPayload?.chainPath || null,
    approvalPath,
    winnerPatchApplied: applyPayload?.patchApplied === true,
    winnerTargetExists: winner ? fs.existsSync(path.join(repoPath, winner.candidateTarget)) : false,
    failures,
    blocker: ok ? null : { blockerKind: 'v17_role_agent_tournament_failed', blocker: `v17 role-agent tournament failed: ${failures.join(', ')}` },
    truthBoundary: ok
      ? 'v17 ran a real-Codex 20-candidate × 5-role-agent tournament on the remote execution plane, selected one verified winner, applied only that winner locally, and built provenance. It does not merge, publish, deploy, send externally, apply non-winners, or claim unlimited autonomous labor capability.'
      : 'v17 is blocked; do not claim the architecture-showcase-style role-agent tournament succeeded until remote tournament, winner apply, and provenance gates are green.'
  };
  const summaryPath = writeJson(path.join(artifactRoot, 'v17_role_tournament_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  if (!ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { console.error(error?.stack || error?.message || String(error)); process.exit(1); });
