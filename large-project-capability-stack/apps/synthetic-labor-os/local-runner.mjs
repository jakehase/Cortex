#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildJobClaimGate,
  buildLocalWorkerRun,
  createArtifactBundleManifest,
  createCommandExecutionResult,
  createJobTestContract,
  createLocalExecutionPlan,
  recordJobTestEvidence,
  transitionJob,
  writeSyntheticLaborOsJob
} from '../../packages/synthetic-labor-os/index.mjs';

export {
  buildJobClaimGate,
  buildLocalWorkerRun,
  createLocalExecutionPlan
} from '../../packages/synthetic-labor-os/index.mjs';

function parseArgs(argv) {
  const args = {
    jobPath: null,
    artifactRoot: null,
    cwd: null,
    commands: [],
    actor: 'synthetic-labor-os-local-runner',
    complete: true,
    write: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--job') { args.jobPath = next; index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--cwd') { args.cwd = next; index += 1; continue; }
    if (token === '--command') { args.commands.push(next); index += 1; continue; }
    if (token === '--actor') { args.actor = next; index += 1; continue; }
    if (token === '--no-complete') { args.complete = false; continue; }
    if (token === '--no-write') { args.write = false; continue; }
    if (token === '--help' || token === '-h') {
      console.log(`usage:
  node apps/synthetic-labor-os/local-runner.mjs --job JOB_JSON [--artifact-root ROOT] [--cwd DIR] [--command CMD]

Runs deterministic local commands for a queued low-scale Synthetic Labor OS job, records worker evidence, writes an artifact bundle checksum manifest, runs the claim gate, and optionally completes the job if the gate is green. A green bundle check means listed files match the manifest; it does not merge, publish, send externally, deploy, release, or run heavy agent swarms.`);
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (!args.jobPath) throw new Error('--job JOB_JSON is required');
  return args;
}

function loadJob(jobPath) {
  return JSON.parse(fs.readFileSync(jobPath, 'utf8'));
}

function safeFileStamp(value = new Date().toISOString()) {
  return String(value).replace(/[^0-9A-Za-z_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function commandLogPath(runDir, index) {
  return path.join(runDir, `command-${String(index + 1).padStart(2, '0')}.log`);
}

function relArtifactPath(artifactRoot, filePath) {
  const relative = path.relative(artifactRoot, filePath).replaceAll(path.sep, '/');
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : null;
}

function runCommand(command, { cwd, runDir, index }) {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  const finished = Date.now();
  const logPath = commandLogPath(runDir, index);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(logPath, [
    `$ ${command}`,
    `cwd: ${cwd}`,
    `exitCode: ${result.status ?? 1}`,
    `signal: ${result.signal || ''}`,
    '',
    '--- stdout ---',
    result.stdout || '',
    '--- stderr ---',
    result.stderr || '',
    ''
  ].join('\n'));
  return createCommandExecutionResult({
    command,
    cwd,
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    exitCode: result.status ?? 1,
    signal: result.signal || null,
    durationMs: finished - started,
    stdoutBytes: Buffer.byteLength(result.stdout || ''),
    stderrBytes: Buffer.byteLength(result.stderr || ''),
    logPath,
    summary: result.status === 0 ? 'command passed' : 'command failed'
  });
}

function ensureRunnableState(job) {
  if (job.state === 'queued') return job;
  if (job.state === 'running') return job;
  throw new Error(`local runner requires queued or running job; got ${job.state || 'drafted'}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jobPath = path.resolve(args.jobPath);
  const loaded = ensureRunnableState(loadJob(jobPath));
  const artifactRoot = path.resolve(args.artifactRoot || loaded.agentWork?.artifactRoot || path.dirname(jobPath));
  const runDir = path.join(artifactRoot, 'local_runner', loaded.id, safeFileStamp(new Date().toISOString()));
  const cwd = path.resolve(args.cwd || loaded.repoPath || process.cwd());
  const testContract = loaded.artifacts?.testContract || createJobTestContract({ job: loaded });
  const commands = args.commands.length ? args.commands : testContract.commands;
  const executionPlan = createLocalExecutionPlan({ job: loaded, testContract, commands });

  let job = loaded;
  if (job.state === 'queued') {
    job = transitionJob(job, {
      to: 'running',
      actor: args.actor,
      reason: 'local_runner_started',
      artifacts: { executionPlan }
    });
  } else {
    job = { ...job, artifacts: { ...(job.artifacts || {}), executionPlan } };
  }

  let commandResults = [];
  if (executionPlan.ok) {
    commandResults = executionPlan.commands.map((command, index) => runCommand(command, { cwd, runDir, index }));
  }

  const workerRun = buildLocalWorkerRun({ job, executionPlan, commandResults, evidenceRefs: commandResults.map((result) => result.logPath) });
  job = recordJobTestEvidence(job, {
    testContract,
    testRuns: commandResults.map((result) => ({
      command: result.command,
      ok: result.ok,
      exitCode: result.exitCode,
      summary: result.summary,
      artifactRef: result.logPath
    })),
    documentationRefs: testContract.docsRefs
  });
  const claimGate = buildJobClaimGate({ job, workerRun, testEvidence: job.artifacts.testEvidence });
  job = {
    ...job,
    artifacts: {
      ...(job.artifacts || {}),
      executionPlan,
      localWorkerRun: workerRun,
      claimGate,
      completionSummary: claimGate.completionSummary
    },
    metrics: {
      ...(job.metrics || {}),
      localCommandCount: workerRun.commandCount,
      localFailedCommandCount: workerRun.failedCommandCount,
      localCompletedItemCount: workerRun.completedItemCount
    }
  };

  if (args.complete && claimGate.completionClaimAllowed === true && job.state === 'running') {
    job = transitionJob(job, {
      to: 'completed',
      actor: args.actor,
      reason: 'local_runner_claim_gate_green',
      artifacts: { completionSummary: claimGate.completionSummary }
    });
  } else if (claimGate.completionClaimAllowed !== true && job.state === 'running') {
    job = transitionJob(job, {
      to: 'blocked',
      actor: args.actor,
      reason: 'local_runner_claim_gate_red',
      blocker: claimGate.blocker,
      artifacts: { completionSummary: claimGate.completionSummary }
    });
  }

  const written = {
    executionPlanPath: writeJson(path.join(runDir, 'execution_plan.json'), executionPlan),
    workerRunPath: writeJson(path.join(runDir, 'worker_run.json'), workerRun),
    claimGatePath: writeJson(path.join(runDir, 'claim_gate.json'), claimGate),
    completionSummaryPath: writeJson(path.join(runDir, 'completion_summary.json'), claimGate.completionSummary)
  };

  if (args.write) {
    fs.writeFileSync(jobPath, `${JSON.stringify(job, null, 2)}\n`);
    written.jobPath = writeSyntheticLaborOsJob({ job, jobsDir: path.join(artifactRoot, 'jobs'), fileName: `${job.id}.json` }).jobPath;
  }

  const bundlePaths = [
    ...commandResults.map((result) => result.logPath),
    written.executionPlanPath,
    written.workerRunPath,
    written.claimGatePath,
    written.completionSummaryPath
  ]
    .map((filePath) => relArtifactPath(artifactRoot, filePath))
    .filter(Boolean);
  const artifactBundle = createArtifactBundleManifest({
    artifactRoot,
    includePaths: bundlePaths,
    label: `local-runner-${job.id}`,
    createdBy: args.actor
  });
  written.artifactBundleManifestPath = writeJson(path.join(artifactRoot, 'artifact_bundle_manifest.json'), artifactBundle);

  console.log(JSON.stringify({
    ok: claimGate.completionClaimAllowed === true,
    jobId: job.id,
    state: job.state,
    runDir,
    written,
    artifactBundle,
    truthBoundary: 'Local runner evidence is scoped to this job contract. It does not merge, publish, send externally, or prove remote scale.',
    claimGate
  }, null, 2));

  if (claimGate.completionClaimAllowed !== true) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
