#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
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
    model: process.env.SYNTHETIC_LABOR_OS_CODEX_MODEL || '',
    maxRuntimeMs: Number(process.env.SYNTHETIC_LABOR_OS_CODEX_MAX_RUNTIME_MS || 120000)
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
    if (token === '--model') { args.model = next; index += 1; continue; }
    if (token === '--max-runtime-ms') { args.maxRuntimeMs = Number(next); index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v4-remote-patch-pilot.mjs [--artifact-root ROOT] [--remote HOST] [--remote-repo PATH] [--remote-artifact-root PATH] [--codex-bin PATH] [--model MODEL]');
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceRoot = path.resolve(args.workspaceRoot || process.env.CLAWD_WORKSPACE_ROOT || defaultWorkspaceRoot());
  const repoPath = path.join(workspaceRoot, 'large-project-capability-stack');
  const artifactRoot = path.resolve(args.artifactRoot || 'artifacts/synthetic-labor-os-v4/latest');
  const jobsDir = path.join(artifactRoot, 'jobs');
  const generatedAt = new Date().toISOString();
  const jobId = 'slos-v4-remote-codex-patch-pilot';
  const remoteArtifactRoot = args.remoteArtifactRoot || `${args.remoteRepoPath.replace(/\/+$/, '')}/artifacts/synthetic-labor-os-v4/latest`;
  const modelArg = args.model ? ` --model ${shellQuote(args.model)}` : '';
  const remoteCommand = [
    'PATH=/home/jake/.local/bin:$PATH',
    `CODEX_BIN=${shellQuote(args.codexBin)}`,
    'node apps/synthetic-labor-os/codex-patch-proposal-work-item.mjs',
    `--job-id ${shellQuote(jobId)}`,
    '--artifact-root artifacts/synthetic-labor-os-v4/latest',
    '--repo-root .',
    `--codex-bin ${shellQuote(args.codexBin)}`,
    `--max-runtime-ms ${Math.floor(args.maxRuntimeMs)}`,
    '--allowed-target docs/SYNTHETIC_LABOR_OS_V4_PATCH_PROPOSAL.md',
    modelArg.trim()
  ].filter(Boolean).join(' ');

  const job = createJob({
    id: jobId,
    createdAt: generatedAt,
    createdBy: 'synthetic-labor-os-v4-remote-patch-pilot',
    objective: {
      id: jobId,
      title: 'Synthetic Labor OS v4 remote Codex patch-proposal pilot',
      outcome: 'Prove the OS can dispatch one bounded Codex patch-proposal work item to Hetzner, return a reviewable diff artifact, verify it with git apply --check, and keep it unapplied for operator review.',
      requestedFidelity: 'production_slice',
      stopCondition: 'remote patch proposal proof review-ready or blocker artifact'
    },
    repoPath,
    artifactRoot,
    requestedAgentCount: 1,
    fidelity: 'production_slice',
    executionPlane: { requiredHostRole: 'execution_plane', remoteHost: args.remoteHost }
  });
  const testContract = createJobTestContract({
    job,
    generatedAt,
    commands: [remoteCommand],
    docsRefs: ['docs/SYNTHETIC_LABOR_OS_V0.md'],
    expectedEvidence: ['codex_patch_proposal_proof', 'patch_proposal_diff', 'git_apply_check', 'remote_dispatch_result'],
    invariants: [
      'remote execution must run on Hetzner, not the OpenClaw control-plane host',
      'current SLOS code must hash-match remotely before the run is accepted',
      'the command must invoke Codex CLI through codex-patch-proposal-work-item.mjs',
      'returned artifacts must include codex_patch_proposal_proof.json and patch_proposal.diff',
      'the patch proposal must touch only allowed target files',
      'git apply --check must pass without changing files',
      'this pilot does not apply, merge, publish, send externally, or claim implementation'
    ]
  });
  const compiled = compileJobContract(job, {
    generatedAt,
    artifactRoot,
    surfaces: ['remote_codex_patch_command', 'patch_proposal_artifact', 'patch_dry_run_gate', 'artifact_return', 'review_ready_gate']
  });
  const workQueue = createWorkQueueArtifact({
    job: compiled,
    generatedAt,
    workItems: [{
      id: 'v4-remote-codex-patch-proposal',
      title: 'Run one bounded remote Codex patch proposal and return review artifacts',
      surfaceId: 'remote_codex_patch_command',
      state: 'ready',
      assignedAgentId: 'remote-codex-patch-agent-1',
      requiredEvidence: ['codex_patch_proposal_proof', 'patch_proposal_diff', 'git_apply_check', 'remote_dispatch_result']
    }]
  });
  const queued = queueJob({ ...compiled, artifacts: { ...compiled.artifacts, testContract } }, { generatedAt, queue: workQueue });
  const { jobPath } = writeSyntheticLaborOsJob({ job: queued, jobsDir });
  writeJson(path.join(artifactRoot, 'v4_remote_patch_pilot_input.json'), {
    schemaVersion: 'claw.synthetic_labor_os.v4.remote_patch_pilot_input',
    generatedAt,
    workspaceRoot,
    repoPath,
    artifactRoot,
    jobPath,
    remoteHost: args.remoteHost,
    remoteRepoPath: args.remoteRepoPath,
    remoteArtifactRoot,
    codexBin: args.codexBin,
    model: args.model || null,
    maxRuntimeMs: args.maxRuntimeMs,
    command: remoteCommand,
    truthBoundary: 'v4 pilot dispatches one bounded patch-proposal job to the remote execution plane. It returns a reviewable diff but does not apply, merge, publish, send, or claim implementation.'
  });

  const dispatcher = path.join(repoPath, 'apps/synthetic-labor-os/remote-dispatcher.mjs');
  const run = spawnSync(process.execPath, [
    dispatcher,
    '--job', jobPath,
    '--artifact-root', artifactRoot,
    '--local-repo', repoPath,
    '--remote', args.remoteHost,
    '--remote-repo', args.remoteRepoPath,
    '--remote-artifact-root', remoteArtifactRoot,
    '--command', remoteCommand
  ], {
    cwd: repoPath,
    encoding: 'utf8',
    maxBuffer: 70 * 1024 * 1024
  });
  fs.writeFileSync(path.join(artifactRoot, 'v4_remote_dispatcher.stdout.json'), run.stdout || '');
  fs.writeFileSync(path.join(artifactRoot, 'v4_remote_dispatcher.stderr.log'), run.stderr || '');
  const dispatcherPayload = run.stdout ? JSON.parse(run.stdout) : null;
  const finalJob = readJson(jobPath, {});
  const dispatchDir = dispatcherPayload?.dispatchDir || null;
  const returnedRoot = dispatchDir ? path.join(dispatchDir, 'returned_artifacts') : null;
  const patchProofPath = returnedRoot ? findNewestProof(returnedRoot) : null;
  const patchProof = patchProofPath ? readJson(patchProofPath, null) : null;
  const remoteResult = finalJob.artifacts?.remoteDispatchResult || dispatcherPayload?.result || null;
  const failures = [];
  if (run.status !== 0) failures.push('dispatcher_exit_nonzero');
  if (dispatcherPayload?.ok !== true) failures.push('remote_dispatch_not_ok');
  if (remoteResult?.ok !== true) failures.push('remote_result_not_ok');
  if (!patchProofPath) failures.push('missing_returned_patch_proposal_proof');
  if (patchProof?.ok !== true) failures.push('patch_proposal_proof_not_ok');
  if (patchProof?.reviewReady !== true) failures.push('patch_proposal_not_review_ready');
  if (patchProof?.patchApplied !== false) failures.push('patch_was_applied');
  if (patchProof?.codex?.exitCode !== 0) failures.push('codex_exit_nonzero');
  if (patchProof?.patchVerification?.gitApplyCheck?.ok !== true) failures.push('git_apply_check_not_ok');

  const ok = failures.length === 0;
  const summary = {
    schemaVersion: 'claw.synthetic_labor_os.v4.remote_patch_pilot_summary',
    generatedAt: new Date().toISOString(),
    ok,
    dispatcherExitCode: run.status,
    jobId: finalJob.id || jobId,
    jobState: finalJob.state || null,
    completionClaimAllowedForProposalJob: finalJob.truth?.completionClaimAllowed === true,
    remoteDispatchOk: remoteResult?.ok === true,
    patchProposalProofOk: patchProof?.ok === true,
    reviewReady: patchProof?.reviewReady === true,
    patchApplied: patchProof?.patchApplied === true,
    codexExitCode: patchProof?.codex?.exitCode ?? null,
    codexVersion: patchProof?.codex?.version || null,
    codexDurationMs: patchProof?.codex?.durationMs ?? null,
    observedPositiveTokenValueCount: patchProof?.eventSummary?.observedPositiveTokenValueCount ?? null,
    observedPositiveTokenValueTotal: patchProof?.eventSummary?.observedPositiveTokenValueTotal ?? null,
    targetFiles: patchProof?.patchProposal?.targetFiles || [],
    patchProposalPath: patchProof?.patchProposal?.path || null,
    artifactRoot,
    jobPath,
    remoteHost: args.remoteHost,
    remoteArtifactRoot,
    dispatchDir,
    returnedPatchProofPath: patchProofPath,
    failures,
    blocker: ok ? null : { blockerKind: 'remote_patch_pilot_failed', blocker: `Remote patch pilot failed: ${failures.join(', ')}` },
    truthBoundary: ok
      ? 'This v4 pilot proves one bounded remote Codex patch proposal is review-ready with returned artifacts and git apply --check. The patch was not applied, merged, published, sent externally, or claimed as implementation.'
      : 'The v4 pilot is blocked; do not apply, merge, publish, or claim implementation from this patch proposal.'
  };
  writeJson(path.join(artifactRoot, 'v4_remote_patch_pilot_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, dispatcherPayload }, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
