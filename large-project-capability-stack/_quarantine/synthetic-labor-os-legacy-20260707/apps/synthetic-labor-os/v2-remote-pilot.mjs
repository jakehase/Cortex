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
    command: 'node --test tests/synthetic-labor-os-remote-smoke.test.mjs'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--workspace-root') { args.workspaceRoot = next; index += 1; continue; }
    if (token === '--remote' || token === '--remote-host') { args.remoteHost = next; index += 1; continue; }
    if (token === '--remote-repo') { args.remoteRepoPath = next; index += 1; continue; }
    if (token === '--remote-artifact-root') { args.remoteArtifactRoot = next; index += 1; continue; }
    if (token === '--command') { args.command = next; index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v2-remote-pilot.mjs [--artifact-root ROOT] [--remote HOST] [--remote-repo PATH] [--remote-artifact-root PATH] [--command CMD]');
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceRoot = path.resolve(args.workspaceRoot || process.env.CLAWD_WORKSPACE_ROOT || defaultWorkspaceRoot());
  const repoPath = path.join(workspaceRoot, 'large-project-capability-stack');
  const artifactRoot = path.resolve(args.artifactRoot || 'artifacts/synthetic-labor-os-v2/latest');
  const jobsDir = path.join(artifactRoot, 'jobs');
  const generatedAt = new Date().toISOString();
  const remoteArtifactRoot = args.remoteArtifactRoot || `${args.remoteRepoPath.replace(/\/+$/, '')}/artifacts/synthetic-labor-os-v2/latest`;

  const job = createJob({
    id: 'slos-v2-remote-dispatch-pilot',
    createdAt: generatedAt,
    createdBy: 'synthetic-labor-os-v2-remote-pilot',
    objective: {
      id: 'slos-v2-remote-dispatch-pilot',
      title: 'Synthetic Labor OS v2 remote execution-plane dispatch pilot',
      outcome: 'Prove the control plane can sync code/job state to Hetzner, run a bounded remote job, return artifacts, and gate completion from returned evidence.',
      requestedFidelity: 'production_slice',
      stopCondition: 'remote dispatch result green or blocker artifact'
    },
    repoPath,
    artifactRoot,
    requestedAgentCount: 1,
    fidelity: 'production_slice'
  });
  const testContract = createJobTestContract({
    job,
    generatedAt,
    commands: [args.command],
    docsRefs: ['docs/SYNTHETIC_LABOR_OS_V0.md'],
    invariants: [
      'local control plane must sync current SLOS code before remote execution',
      'remote code hash proof must match local code hash proof',
      'remote local-runner must complete the queued job through its claim gate',
      'remote artifacts must return before the control plane accepts completion',
      'remote dispatch does not merge, publish, send externally, or launch heavy swarms'
    ]
  });
  const compiled = compileJobContract(job, {
    generatedAt,
    artifactRoot,
    surfaces: ['remote_code_sync', 'remote_job_dispatch', 'remote_worker_run', 'artifact_return', 'remote_claim_gate']
  });
  const workQueue = createWorkQueueArtifact({
    job: compiled,
    generatedAt,
    workItems: [{
      id: 'v2-remote-dispatch-work-item',
      title: 'Dispatch one deterministic validation job to Hetzner and return artifacts',
      surfaceId: 'remote_job_dispatch',
      state: 'ready',
      assignedAgentId: 'remote-runner-1',
      requiredEvidence: ['sync_proof', 'remote_runner_log', 'returned_artifacts', 'remote_dispatch_result']
    }]
  });
  const queued = queueJob({ ...compiled, artifacts: { ...compiled.artifacts, testContract } }, { generatedAt, queue: workQueue });
  const { jobPath } = writeSyntheticLaborOsJob({ job: queued, jobsDir });
  writeJson(path.join(artifactRoot, 'v2_remote_pilot_input.json'), {
    schemaVersion: 'claw.synthetic_labor_os.v2.remote_pilot_input',
    generatedAt,
    workspaceRoot,
    repoPath,
    artifactRoot,
    jobPath,
    remoteHost: args.remoteHost,
    remoteRepoPath: args.remoteRepoPath,
    remoteArtifactRoot,
    command: args.command,
    truthBoundary: 'v2 pilot dispatches one low-scale job to a remote execution plane. It is not a heavy swarm or broad scale claim.'
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
    '--command', args.command
  ], {
    cwd: repoPath,
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024
  });
  fs.writeFileSync(path.join(artifactRoot, 'v2_remote_dispatcher.stdout.json'), run.stdout || '');
  fs.writeFileSync(path.join(artifactRoot, 'v2_remote_dispatcher.stderr.log'), run.stderr || '');
  const dispatcherPayload = run.stdout ? JSON.parse(run.stdout) : null;
  const finalJob = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  const summary = {
    schemaVersion: 'claw.synthetic_labor_os.v2.remote_pilot_summary',
    generatedAt: new Date().toISOString(),
    ok: run.status === 0 && dispatcherPayload?.ok === true && finalJob.artifacts?.remoteDispatchResult?.ok === true,
    dispatcherExitCode: run.status,
    jobId: finalJob.id,
    jobState: finalJob.state,
    completionClaimAllowed: finalJob.truth?.completionClaimAllowed === true,
    remoteDispatchOk: finalJob.artifacts?.remoteDispatchResult?.ok === true,
    artifactRoot,
    jobPath,
    remoteHost: args.remoteHost,
    remoteArtifactRoot,
    dispatchDir: dispatcherPayload?.dispatchDir || null,
    truthBoundary: 'This v2 pilot proves a bounded remote execution-plane dispatch for one job. It does not merge, publish, send externally, or prove broad scale.'
  };
  writeJson(path.join(artifactRoot, 'v2_remote_pilot_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, dispatcherPayload }, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
