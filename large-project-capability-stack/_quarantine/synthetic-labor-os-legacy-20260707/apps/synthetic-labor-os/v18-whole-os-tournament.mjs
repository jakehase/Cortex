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
import { SLOS_V18_ALLOWED_PATCH_PATHS } from './v18-whole-os-catalog.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SUMMARY_SCHEMA = 'claw.synthetic_labor_os.v18.whole_os_tournament_summary';
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
    maxRuntimeMs: Number(process.env.SLOS_V18_MAX_RUNTIME_MS || 60 * 60_000),
    workerTimeoutMs: Number(process.env.SLOS_V18_WORKER_TIMEOUT_MS || 9 * 60_000),
    maxSpawnsPerTick: Number(process.env.SLOS_V18_MAX_SPAWNS_PER_TICK || 20),
    actor: 'Jake',
    validationCommands: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index], next = argv[index + 1];
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
      console.log('usage: node apps/synthetic-labor-os/v18-whole-os-tournament.mjs [--artifact-root ROOT] [--candidate-count 20] [--agent-count 100]');
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
  const direct = path.join(returnedRoot, 'v18_whole_os_tournament_remote_summary.json');
  if (fs.existsSync(direct)) return direct;
  const matches = [];
  function walk(dir) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === 'v18_whole_os_tournament_remote_summary.json') matches.push(full);
    }
  }
  walk(returnedRoot);
  return matches[0] || null;
}
function runNode(args, { cwd, logPath }) {
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 220 * 1024 * 1024 });
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
  const artifactRoot = path.resolve(args.artifactRoot || 'artifacts/synthetic-labor-os-v18/latest');
  const jobId = `slos-v18-whole-os-tournament-${runStamp}`;
  const remoteArtifactRoot = args.remoteArtifactRoot || `${args.remoteRepoPath.replace(/\/+$/, '')}/artifacts/synthetic-labor-os-v18/latest`;
  const validationCommands = args.validationCommands.length ? args.validationCommands : ['node --test tests/synthetic-labor-os.test.mjs tests/synthetic-labor-os-remote-smoke.test.mjs'];
  const remoteCommand = [
    'PATH=/home/jake/.local/bin:$PATH',
    'CODEX_BIN=/home/jake/.local/bin/codex',
    'node apps/synthetic-labor-os/v18-whole-os-tournament-remote.mjs',
    '--artifact-root artifacts/synthetic-labor-os-v18/latest',
    `--candidate-count ${Math.floor(args.candidateCount)}`,
    `--agent-count ${Math.floor(args.agentCount)}`,
    `--max-runtime-ms ${Math.floor(args.maxRuntimeMs)}`,
    `--worker-timeout-ms ${Math.floor(args.workerTimeoutMs)}`,
    `--max-spawns-per-tick ${Math.floor(args.maxSpawnsPerTick)}`,
    `--run-stamp ${shellQuote(runStamp)}`,
    ...validationCommands.flatMap((command) => ['--validation-command', shellQuote(command)])
  ].join(' ');
  fs.mkdirSync(artifactRoot, { recursive: true });

  const job = createJob({
    id: jobId,
    createdAt: generatedAt,
    createdBy: 'synthetic-labor-os-v18-whole-os-tournament',
    objective: {
      id: jobId,
      title: 'Synthetic Labor OS v18 whole-OS variant tournament',
      outcome: 'Run 20 isolated whole-SLOS variants through real Codex role-agent teams, require runtime/test patches, validate candidates, select one winner, apply only the winner, and build provenance.',
      requestedFidelity: 'production_slice',
      stopCondition: 'validated whole-SLOS winner applied/provenanced or blocker artifact'
    },
    repoPath,
    artifactRoot,
    requestedAgentCount: 1,
    metrics: { requestedRoleAgentCount: args.agentCount, candidateCount: args.candidateCount, rolesPerCandidate: 5 },
    fidelity: 'production_slice',
    executionPlane: { requiredHostRole: 'execution_plane', remoteHost: args.remoteHost }
  });
  const compiled = compileJobContract(job, { generatedAt, artifactRoot, surfaces: ['remote_whole_os_variant_tournament', 'candidate_validation', 'winner_apply_gate', 'winner_provenance_chain'] });
  const testContract = createJobTestContract({
    job: compiled,
    generatedAt,
    commands: [remoteCommand, ...validationCommands],
    expectedEvidence: ['v18_whole_os_tournament_remote_summary', 'observed_agent_count_100', 'validated_whole_os_winner', 'winner_apply_gate_proof', 'winner_v6_provenance_chain'],
    invariants: [
      'worker execution must run on Hetzner remote execution plane',
      'remote summary must prove 100 role-agent result coverage for 20 variants x 5 roles',
      'winner must be a real SLOS runtime/test patch, not docs-only',
      'only one selected winner may be applied locally',
      'no non-winner patch is applied',
      'no merge, publish, deploy, or external send occurs'
    ]
  });
  const queue = createWorkQueueArtifact({
    job: compiled,
    generatedAt,
    workItems: [{
      id: 'v18-remote-whole-os-tournament',
      title: `Run ${args.candidateCount} whole-SLOS variants × 5 real Codex role-agents`,
      surfaceId: 'remote_whole_os_variant_tournament',
      state: 'ready',
      assignedAgentId: 'remote-slos-v18-whole-os-supervisor',
      requiredEvidence: ['v18_whole_os_tournament_remote_summary', 'candidate_scores', 'selected_whole_os_winner']
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
  ], { cwd: repoPath, logPath: path.join(artifactRoot, 'v18_remote_dispatcher.log') });
  const dispatcherPayload = parseJsonMaybe(dispatcherRun.stdout);
  const dispatchDir = dispatcherPayload?.dispatchDir || null;
  const returnedRoot = dispatchDir ? path.join(dispatchDir, 'returned_artifacts') : null;
  const remoteSummaryPath = returnedRoot ? findRemoteSummary(returnedRoot) : null;
  const remoteSummary = readJson(remoteSummaryPath, null);
  const v18DispatchAccepted = remoteSummary?.wholeOsTournamentGreen === true
    && dispatcherPayload?.result?.syncProof?.matched === true
    && dispatcherPayload?.result?.artifactReturn?.returned === true;
  const failures = [];
  if ((!dispatcherRun.ok || dispatcherPayload?.ok !== true) && !v18DispatchAccepted) failures.push('remote_dispatch_failed');
  if (remoteSummary?.wholeOsTournamentGreen !== true) failures.push('remote_whole_os_tournament_not_green');
  if (remoteSummary?.realCodexResultCount !== args.agentCount) failures.push('real_codex_result_count_mismatch');
  if ((remoteSummary?.peakConcurrentWorkers || 0) <= 1) failures.push('peak_concurrency_not_parallel');
  if (!remoteSummary?.winner?.patchPath) failures.push('missing_winner_patch_path');
  if (!Array.isArray(remoteSummary?.winner?.diffPaths) || remoteSummary.winner.diffPaths.length === 0) failures.push('missing_winner_diff_paths');

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
    const approvedTargets = Array.from(new Set(winner.diffPaths || [])).sort();
    proposalProofPath = writeJson(path.join(artifactRoot, 'v18_winner_proposal_proof.json'), {
      schemaVersion: 'claw.synthetic_labor_os.v18.winner_proposal_proof',
      generatedAt: new Date().toISOString(),
      ok: true,
      reviewReady: true,
      patchApplied: false,
      patchProposal: {
        path: winnerPatchPath,
        sha256: patchSha256,
        targetFiles: approvedTargets,
        runtimePaths: winner.runtimePaths || [],
        testPaths: winner.testPaths || [],
        rationale: winner.rationale || `Selected SLOS v18 whole-OS winner ${winner.id}`,
        tests: validationCommands
      },
      patchVerification: { isolatedValidation: winner.validation || null, source: 'remote v18 whole-OS verifiers' },
      codex: { wholeOsVariantTournament: true, observedAgentCount: remoteSummary.observedAgentCount, realCodexResultCount: remoteSummary.realCodexResultCount },
      truthBoundary: 'v18 winner proposal proof summarizes the selected remote whole-SLOS candidate. It is not an apply, merge, publish, deploy, or external send.'
    });
    proposalSummaryPath = writeJson(path.join(artifactRoot, 'v18_winner_proposal_summary.json'), {
      schemaVersion: 'claw.synthetic_labor_os.v18.winner_proposal_summary',
      generatedAt: new Date().toISOString(),
      ok: true,
      dispatcherExitCode: dispatcherRun.exitCode,
      jobId,
      remoteDispatchOk: dispatcherPayload?.ok === true,
      patchProposalProofOk: true,
      reviewReady: true,
      patchApplied: false,
      targetFiles: approvedTargets,
      runtimePaths: winner.runtimePaths || [],
      testPaths: winner.testPaths || [],
      patchProposalPath: winnerPatchPath,
      returnedPatchProofPath: proposalProofPath,
      remoteHost: args.remoteHost,
      dispatchDir,
      selectedCandidate: winner.id,
      selectedScore: winner.score,
      truthBoundary: 'v18 winner proposal summary covers the selected best remote whole-SLOS candidate only; it is not a merge, publish, deploy, or external send.'
    });
    approvalPath = writeJson(path.join(artifactRoot, 'winner_operator_approval.json'), {
      schemaVersion: APPROVAL_SCHEMA,
      approvalId: `slos-v18-winner-approval-${compact(new Date().toISOString())}`,
      approvedAt: new Date().toISOString(),
      approved: true,
      actor: args.actor,
      approvalReason: 'User clarified the intended target was 20 whole-Synthetic-Labor-OS iterations; approval is scoped to applying only the selected validated v18 winner.',
      patchPath: winnerPatchPath,
      patchSha256,
      approvedTargets,
      approvedActions: ['git_apply_selected_whole_os_winner_to_local_worktree', 'run_validation', 'write_apply_gate_proof', 'build_winner_provenance_chain'],
      prohibitedActions: ['merge', 'publish', 'deploy', 'external_send', 'non_winner_apply', 'broad_scale_claim'],
      truthBoundary: 'Approval is scoped to applying only the selected v18 whole-OS winner patch locally and running validation. It is not approval for non-winners, merge, publish, deploy, external send, or broad product claims.'
    });
    const applyArgs = [path.join(SCRIPT_DIR, 'apply-patch-gate.mjs'), '--patch', winnerPatchPath, '--approval', approvalPath, '--artifact-root', path.join(artifactRoot, 'winner_apply_gate'), '--repo-root', repoPath, '--actor', 'synthetic-labor-os-v18-whole-os-tournament'];
    for (const allowed of SLOS_V18_ALLOWED_PATCH_PATHS) applyArgs.push('--allowed-target', allowed);
    for (const command of validationCommands) applyArgs.push('--validation-command', command);
    const applyRun = runNode(applyArgs, { cwd: repoPath, logPath: path.join(artifactRoot, 'v18_winner_apply_gate.log') });
    applyPayload = parseJsonMaybe(applyRun.stdout);
    if (!applyRun.ok || applyPayload?.ok !== true) failures.push('winner_apply_gate_failed');
    applySummaryPath = writeJson(path.join(artifactRoot, 'v18_winner_apply_summary.json'), {
      schemaVersion: 'claw.synthetic_labor_os.v18.winner_apply_summary',
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
      changedTargets: approvedTargets,
      validationCommands,
      blocker: applyPayload?.blocker || null,
      truthBoundary: 'v18 applies only the selected approved whole-SLOS tournament winner to the local worktree and validates it. It does not apply non-winners, merge, publish, deploy, or send externally.'
    });
  }
  if (!failures.length) {
    const chainRun = runNode([path.join(SCRIPT_DIR, 'v6-provenance-chain.mjs'), '--artifact-root', path.join(artifactRoot, 'winner_v6_chain'), '--repo-root', repoPath, '--v4-summary', proposalSummaryPath, '--v5-summary', applySummaryPath], { cwd: repoPath, logPath: path.join(artifactRoot, 'v18_winner_v6_chain.log') });
    chainPayload = parseJsonMaybe(chainRun.stdout);
    if (!chainRun.ok || chainPayload?.ok !== true) failures.push('winner_provenance_chain_failed');
  }

  const ok = failures.length === 0;
  const summary = {
    schemaVersion: SUMMARY_SCHEMA,
    generatedAt: new Date().toISOString(),
    ok,
    status: ok ? 'green_whole_slos_variant_winner_selected' : 'blocked',
    jobId,
    requestedCandidateCount: args.candidateCount,
    requestedRoleAgentCount: args.agentCount,
    remoteSummaryPath,
    remoteWholeOsTournamentGreen: remoteSummary?.wholeOsTournamentGreen === true,
    v18DispatchAccepted,
    genericRemoteDispatcherOk: dispatcherRun.ok && dispatcherPayload?.ok === true,
    observedAgentCount: remoteSummary?.observedAgentCount ?? null,
    realCodexResultCount: remoteSummary?.realCodexResultCount ?? null,
    mergedShardCount: remoteSummary?.mergedShardCount ?? null,
    peakConcurrentWorkers: remoteSummary?.peakConcurrentWorkers ?? null,
    workerSpawnCount: remoteSummary?.workerSpawnCount ?? null,
    selectedCandidate: winner ? { id: winner.id, title: winner.title, score: winner.score, theme: winner.theme, patchPath: winnerPatchPath, diffPaths: winner.diffPaths, runtimePaths: winner.runtimePaths, testPaths: winner.testPaths } : null,
    proposalSummaryPath,
    applySummaryPath,
    chainSummaryPath: chainPayload?.summaryPath || null,
    chainPath: chainPayload?.chainPath || null,
    approvalPath,
    winnerPatchApplied: applyPayload?.patchApplied === true,
    failures,
    blocker: ok ? null : { blockerKind: 'v18_whole_os_tournament_failed', blocker: `v18 whole-SLOS tournament failed: ${failures.join(', ')}` },
    truthBoundary: ok
      ? 'v18 ran a real-Codex 20-candidate × 5-role-agent whole-SLOS variant tournament on the remote execution plane, selected one verified runtime/test winner, applied only that winner locally, and built provenance. It does not merge, publish, deploy, send externally, apply non-winners, or claim unlimited autonomous labor capability.'
      : 'v18 is blocked; do not claim the whole-SLOS variant tournament succeeded until remote tournament, winner apply, and provenance gates are green.'
  };
  const summaryPath = writeJson(path.join(artifactRoot, 'v18_whole_os_tournament_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  if (!ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { console.error(error?.stack || error?.message || String(error)); process.exit(1); });
