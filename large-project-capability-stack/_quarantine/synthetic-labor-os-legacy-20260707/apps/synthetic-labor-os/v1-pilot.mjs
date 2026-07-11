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
    command: 'node --test tests/synthetic-labor-os.test.mjs'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--workspace-root') { args.workspaceRoot = next; index += 1; continue; }
    if (token === '--command') { args.command = next; index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v1-pilot.mjs [--artifact-root ROOT] [--workspace-root ROOT] [--command CMD]');
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
  const artifactRoot = path.resolve(args.artifactRoot || 'artifacts/synthetic-labor-os-v1/latest');
  const jobsDir = path.join(artifactRoot, 'jobs');
  const generatedAt = new Date().toISOString();

  const job = createJob({
    id: 'slos-v1-local-runner-pilot',
    createdAt: generatedAt,
    createdBy: 'synthetic-labor-os-v1-pilot',
    objective: {
      id: 'slos-v1-local-runner-pilot',
      title: 'Synthetic Labor OS v1 local execution loop pilot',
      outcome: 'Prove a queued OS job can run deterministic local work, attach evidence, and complete only through a claim gate.',
      requestedFidelity: 'production_slice',
      stopCondition: 'local claim gate green or blocker artifact'
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
      'queued job transitions to running before command execution',
      'command logs are written before claim gate evaluation',
      'completion requires local worker run ok and test evidence ok',
      'local runner does not merge, publish, send externally, or launch heavy workers'
    ]
  });
  const compiled = compileJobContract(job, {
    generatedAt,
    artifactRoot,
    surfaces: ['local_execution_plan', 'deterministic_command_run', 'worker_run_evidence', 'claim_gate']
  });
  const workQueue = createWorkQueueArtifact({
    job: compiled,
    generatedAt,
    workItems: [{
      id: 'v1-local-runner-work-item',
      title: 'Execute deterministic local validation command and record claim-gated evidence',
      surfaceId: 'deterministic_command_run',
      state: 'ready',
      assignedAgentId: 'local-runner-1',
      requiredEvidence: ['execution_plan', 'command_log', 'worker_run', 'claim_gate']
    }]
  });
  const queued = queueJob({ ...compiled, artifacts: { ...compiled.artifacts, testContract } }, { generatedAt, queue: workQueue });
  const { jobPath } = writeSyntheticLaborOsJob({ job: queued, jobsDir });
  writeJson(path.join(artifactRoot, 'v1_pilot_input.json'), {
    schemaVersion: 'claw.synthetic_labor_os.v1.pilot_input',
    generatedAt,
    workspaceRoot,
    repoPath,
    artifactRoot,
    jobPath,
    command: args.command,
    truthBoundary: 'v1 pilot creates and runs one low-scale local job. It is not a heavy agent run.'
  });

  const localRunner = path.join(repoPath, 'apps/synthetic-labor-os/local-runner.mjs');
  const run = spawnSync(process.execPath, [localRunner, '--job', jobPath, '--artifact-root', artifactRoot, '--cwd', repoPath], {
    cwd: repoPath,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  fs.writeFileSync(path.join(artifactRoot, 'v1_pilot_local_runner.stdout.json'), run.stdout || '');
  fs.writeFileSync(path.join(artifactRoot, 'v1_pilot_local_runner.stderr.log'), run.stderr || '');
  const runnerPayload = run.stdout ? JSON.parse(run.stdout) : null;
  const finalJob = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  const summary = {
    schemaVersion: 'claw.synthetic_labor_os.v1.pilot_summary',
    generatedAt: new Date().toISOString(),
    ok: run.status === 0 && runnerPayload?.ok === true && finalJob.state === 'completed',
    localRunnerExitCode: run.status,
    jobId: finalJob.id,
    jobState: finalJob.state,
    completionClaimAllowed: finalJob.truth?.completionClaimAllowed === true,
    artifactRoot,
    jobPath,
    runnerRunDir: runnerPayload?.runDir || null,
    truthBoundary: 'This v1 pilot proves the local execution loop for one deterministic job. It does not merge, publish, send externally, or prove remote scale.'
  };
  writeJson(path.join(artifactRoot, 'v1_pilot_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, runnerPayload }, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
