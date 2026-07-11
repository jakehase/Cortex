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
      console.log('usage: node apps/synthetic-labor-os/v3-remote-codex-pilot.mjs [--artifact-root ROOT] [--remote HOST] [--remote-repo PATH] [--remote-artifact-root PATH] [--codex-bin PATH] [--model MODEL]');
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
      else if (entry.isFile() && entry.name === 'codex_agent_proof.json') {
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
  const artifactRoot = path.resolve(args.artifactRoot || 'artifacts/synthetic-labor-os-v3/latest');
  const jobsDir = path.join(artifactRoot, 'jobs');
  const generatedAt = new Date().toISOString();
  const jobId = 'slos-v3-remote-codex-agent-pilot';
  const remoteArtifactRoot = args.remoteArtifactRoot || `${args.remoteRepoPath.replace(/\/+$/, '')}/artifacts/synthetic-labor-os-v3/latest`;
  const modelArg = args.model ? ` --model ${shellQuote(args.model)}` : '';
  const remoteCommand = [
    'PATH=/home/jake/.local/bin:$PATH',
    `CODEX_BIN=${shellQuote(args.codexBin)}`,
    'node apps/synthetic-labor-os/codex-agent-work-item.mjs',
    `--job-id ${shellQuote(jobId)}`,
    '--artifact-root artifacts/synthetic-labor-os-v3/latest',
    '--repo-root .',
    `--codex-bin ${shellQuote(args.codexBin)}`,
    `--max-runtime-ms ${Math.floor(args.maxRuntimeMs)}`,
    modelArg.trim()
  ].filter(Boolean).join(' ');

  const job = createJob({
    id: jobId,
    createdAt: generatedAt,
    createdBy: 'synthetic-labor-os-v3-remote-codex-pilot',
    objective: {
      id: jobId,
      title: 'Synthetic Labor OS v3 remote Codex agent work-item pilot',
      outcome: 'Prove the OS can dispatch one bounded real Codex CLI work item to Hetzner, return provenance artifacts, and gate completion from verified agent output.',
      requestedFidelity: 'production_slice',
      stopCondition: 'remote Codex agent proof green or blocker artifact'
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
    expectedEvidence: ['codex_agent_proof', 'codex_events_jsonl', 'codex_last_message', 'remote_dispatch_result'],
    invariants: [
      'remote execution must run on Hetzner, not the OpenClaw control-plane host',
      'current SLOS code must hash-match remotely before the run is accepted',
      'the command must invoke Codex CLI through codex-agent-work-item.mjs',
      'Codex output must include the required done marker and truth boundary',
      'returned artifacts must include codex_agent_proof.json before completion is accepted',
      'this pilot does not merge, publish, send externally, implement product code, or prove broad scale'
    ]
  });
  const compiled = compileJobContract(job, {
    generatedAt,
    artifactRoot,
    surfaces: ['remote_codex_command', 'codex_agent_provenance', 'structured_agent_output', 'artifact_return', 'claim_gate']
  });
  const workQueue = createWorkQueueArtifact({
    job: compiled,
    generatedAt,
    workItems: [{
      id: 'v3-remote-codex-agent-work-item',
      title: 'Run one bounded read-only Codex work item on Hetzner',
      surfaceId: 'remote_codex_command',
      state: 'ready',
      assignedAgentId: 'remote-codex-agent-1',
      requiredEvidence: ['codex_agent_proof', 'codex_last_message', 'codex_events_jsonl', 'remote_dispatch_result']
    }]
  });
  const queued = queueJob({ ...compiled, artifacts: { ...compiled.artifacts, testContract } }, { generatedAt, queue: workQueue });
  const { jobPath } = writeSyntheticLaborOsJob({ job: queued, jobsDir });
  writeJson(path.join(artifactRoot, 'v3_remote_codex_pilot_input.json'), {
    schemaVersion: 'claw.synthetic_labor_os.v3.remote_codex_pilot_input',
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
    truthBoundary: 'v3 pilot dispatches one bounded read-only Codex CLI work item to the remote execution plane. It is not a heavy swarm or product implementation claim.'
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
    maxBuffer: 60 * 1024 * 1024
  });
  fs.writeFileSync(path.join(artifactRoot, 'v3_remote_dispatcher.stdout.json'), run.stdout || '');
  fs.writeFileSync(path.join(artifactRoot, 'v3_remote_dispatcher.stderr.log'), run.stderr || '');
  const dispatcherPayload = run.stdout ? JSON.parse(run.stdout) : null;
  const finalJob = readJson(jobPath, {});
  const dispatchDir = dispatcherPayload?.dispatchDir || null;
  const returnedRoot = dispatchDir ? path.join(dispatchDir, 'returned_artifacts') : null;
  const codexProofPath = returnedRoot ? findNewestProof(returnedRoot) : null;
  const codexProof = codexProofPath ? readJson(codexProofPath, null) : null;
  const remoteResult = finalJob.artifacts?.remoteDispatchResult || dispatcherPayload?.result || null;
  const failures = [];
  if (run.status !== 0) failures.push('dispatcher_exit_nonzero');
  if (dispatcherPayload?.ok !== true) failures.push('remote_dispatch_not_ok');
  if (remoteResult?.ok !== true) failures.push('remote_result_not_ok');
  if (!codexProofPath) failures.push('missing_returned_codex_agent_proof');
  if (codexProof?.ok !== true) failures.push('codex_agent_proof_not_ok');
  if (codexProof?.codex?.exitCode !== 0) failures.push('codex_exit_nonzero');
  if (codexProof?.verification?.ok !== true) failures.push('codex_output_not_verified');

  const ok = failures.length === 0;
  const summary = {
    schemaVersion: 'claw.synthetic_labor_os.v3.remote_codex_pilot_summary',
    generatedAt: new Date().toISOString(),
    ok,
    dispatcherExitCode: run.status,
    jobId: finalJob.id || jobId,
    jobState: finalJob.state || null,
    completionClaimAllowed: finalJob.truth?.completionClaimAllowed === true,
    remoteDispatchOk: remoteResult?.ok === true,
    codexAgentProofOk: codexProof?.ok === true,
    codexExitCode: codexProof?.codex?.exitCode ?? null,
    codexVersion: codexProof?.codex?.version || null,
    codexDurationMs: codexProof?.codex?.durationMs ?? null,
    codexEventCount: codexProof?.eventSummary?.eventCount ?? null,
    observedPositiveTokenValueCount: codexProof?.eventSummary?.observedPositiveTokenValueCount ?? null,
    observedPositiveTokenValueTotal: codexProof?.eventSummary?.observedPositiveTokenValueTotal ?? null,
    artifactRoot,
    jobPath,
    remoteHost: args.remoteHost,
    remoteArtifactRoot,
    dispatchDir,
    returnedCodexProofPath: codexProofPath,
    failures,
    blocker: ok ? null : { blockerKind: 'remote_codex_pilot_failed', blocker: `Remote Codex pilot failed: ${failures.join(', ')}` },
    truthBoundary: ok
      ? 'This v3 pilot proves one bounded read-only Codex CLI work item ran on the remote execution plane, produced verified structured output, passed the remote claim gate, and returned artifacts. It does not prove product implementation, merge, publish, external send, or broad scale.'
      : 'The v3 pilot is blocked; do not claim remote Codex agent completion until dispatch, Codex proof, claim gate, and artifact return are all green.'
  };
  writeJson(path.join(artifactRoot, 'v3_remote_codex_pilot_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, dispatcherPayload }, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
