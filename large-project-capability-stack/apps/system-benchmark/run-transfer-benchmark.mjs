#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createScoreboardRow, upsertBenchmarkScoreboardRow } from '../../packages/system-benchmark/index.mjs';

function writeJson(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(targetPath) {
  return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
}

function runVerifier(command, cwd) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const result = spawnSync('bash', ['-lc', command], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20
  });
  const finishedMs = Date.now();
  return {
    command,
    cwd,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: finishedMs - startedMs,
    ok: result.status === 0,
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

const contractPath = path.resolve(process.argv[2] || '');
if (!contractPath || !fs.existsSync(contractPath)) {
  console.error('Usage: node apps/system-benchmark/run-transfer-benchmark.mjs <run_contract.json>');
  process.exit(1);
}

const contract = readJson(contractPath);
const artifactRoot = path.resolve(contract.artifactRoot);
const repoPath = path.resolve(contract.repoPath);
const scoreboardPath = path.resolve(contract.scoreboardPath);
const startedAt = new Date().toISOString();

const hostRole = process.env.BENCHMARK_HOST_ROLE || process.env.HOST_ROLE || 'control_plane';
const hostname = process.env.HOSTNAME || null;

if (contract.executionBoundary === 'remote_execution_required' && hostRole !== 'execution_plane') {
  const blocker = {
    generatedAt: startedAt,
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    phase: 'boundary_preflight',
    status: 'blocked',
    blocker: 'This benchmark contract requires execution on the execution plane, but it was launched from a control-plane host.',
    nextAction: 'Run this benchmark on VM102 with BENCHMARK_HOST_ROLE=execution_plane, while keeping CT101 as the supervisor/notifier control plane.',
    observedHostRole: hostRole,
    observedHostname: hostname,
    requiredHostRole: 'execution_plane'
  };
  writeJson(path.join(artifactRoot, 'program_state.json'), {
    schemaVersion: 'claw.agent_benchmark_program_state.v1',
    generatedAt: startedAt,
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    status: 'blocked',
    done: true,
    stopAllowed: true,
    stopReason: 'execution_boundary_blocked',
    summary: blocker.blocker
  });
  const surfaceMatrixPath = path.join(artifactRoot, 'surface_matrix.json');
  if (fs.existsSync(surfaceMatrixPath)) {
    const currentSurfaceMatrix = readJson(surfaceMatrixPath);
    currentSurfaceMatrix.generatedAt = new Date().toISOString();
    currentSurfaceMatrix.status = 'blocked';
    writeJson(surfaceMatrixPath, currentSurfaceMatrix);
  }
  writeJson(path.join(artifactRoot, 'blocker_report.json'), blocker);
  writeJson(path.join(artifactRoot, 'supervisor_status.json'), {
    generatedAt: startedAt,
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    supervisorStatus: 'red',
    matrixStatus: 'blocked',
    note: blocker.blocker
  });
  writeJson(path.join(artifactRoot, 'completion_summary.json'), {
    generatedAt: startedAt,
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    baselineReady: false,
    thresholdPass: false,
    supervisorConfirmedCompletion: false,
    executionMode: 'boundary_preflight_blocked',
    durationMinutes: 0,
    blocker,
    note: blocker.blocker
  });
  const row = createScoreboardRow({
    contract,
    metrics: {
      verificationIntegrity: 0,
      autonomyWindowMinutes: 0,
      truthIntegrityContradictions: 0,
      fakeGreenIncidents: 0
    },
    outcome: { pass: false },
    durationMinutes: 0,
    blockerFamily: 'execution_boundary_missing',
    blockerSemantics: 'blocking',
    notes: blocker.blocker
  });
  writeJson(path.join(artifactRoot, 'scoreboard_row.json'), row);
  upsertBenchmarkScoreboardRow({ scoreboardPath, row });
  console.log(JSON.stringify({ ok: false, blocker: blocker.blocker, hostRole, hostname }, null, 2));
  process.exit(2);
}

writeJson(path.join(artifactRoot, 'program_state.json'), {
  schemaVersion: 'claw.agent_benchmark_program_state.v1',
  generatedAt: startedAt,
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  status: 'running',
  done: false,
  stopAllowed: false,
  summary: 'Executing transfer benchmark verifiers.'
});

const verifierExecutions = (contract.verifierSet || []).map((verifier) => {
  const command = verifier.command || verifier.argv?.join(' ') || '';
  return {
    ...verifier,
    execution: runVerifier(command, repoPath)
  };
});

const allVerifiersOk = verifierExecutions.every((entry) => entry.execution.ok);
const surfaceMatrixPath = path.join(artifactRoot, 'surface_matrix.json');
const currentSurfaceMatrix = fs.existsSync(surfaceMatrixPath) ? readJson(surfaceMatrixPath) : null;
if (currentSurfaceMatrix) {
  currentSurfaceMatrix.generatedAt = new Date().toISOString();
  currentSurfaceMatrix.status = allVerifiersOk ? 'baseline_ready' : 'blocked';
  writeJson(surfaceMatrixPath, currentSurfaceMatrix);
}
const durationMs = verifierExecutions.reduce((sum, entry) => sum + Number(entry.execution.durationMs || 0), 0);
const durationMinutes = Number((durationMs / 60000).toFixed(2));
const baselineReady = allVerifiersOk;
const thresholdPass = false;
const blocker = allVerifiersOk
  ? null
  : {
      blocker: 'One or more transfer benchmark verifiers failed.',
      nextAction: 'Repair the benchmark repo or verifier command, then rerun the transfer benchmark baseline.',
      failedVerifiers: verifierExecutions
        .filter((entry) => !entry.execution.ok)
        .map((entry) => ({ command: entry.execution.command, exitCode: entry.execution.exitCode }))
    };

writeJson(path.join(artifactRoot, 'verifier_evidence.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  baselineReady,
  executions: verifierExecutions.map((entry) => ({
    kind: entry.kind || 'command',
    purpose: entry.purpose || '',
    ...entry.execution
  }))
});

if (blocker) {
  writeJson(path.join(artifactRoot, 'blocker_report.json'), {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    phase: 'baseline_verifier_runner',
    status: 'blocked',
    ...blocker
  });
}

writeJson(path.join(artifactRoot, 'supervisor_status.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  supervisorStatus: allVerifiersOk ? 'baseline_ready' : 'red',
  matrixStatus: allVerifiersOk ? 'prepared' : 'blocked',
  note: allVerifiersOk
    ? 'Transfer benchmark baseline verifier pass. Repo is ready for orchestration execution, but threshold-based benchmark scoring is still pending.'
    : 'Transfer benchmark baseline verifier failed.'
});

writeJson(path.join(artifactRoot, 'completion_summary.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  baselineReady,
  thresholdPass,
  supervisorConfirmedCompletion: baselineReady,
  executionMode: 'baseline_verifier_only',
  durationMinutes,
  blocker,
  note: baselineReady
    ? 'Baseline verifier run succeeded. This confirms repo/verifier readiness, not full orchestration benchmark success.'
    : 'Baseline verifier run failed. Transfer benchmark is not yet ready.'
});

writeJson(path.join(artifactRoot, 'program_state.json'), {
  schemaVersion: 'claw.agent_benchmark_program_state.v1',
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  status: allVerifiersOk ? 'baseline_ready' : 'blocked',
  done: true,
  stopAllowed: true,
  stopReason: allVerifiersOk ? 'baseline_verifiers_green' : 'baseline_verifier_failed',
  summary: allVerifiersOk
    ? 'Transfer benchmark baseline verifier pass.'
    : 'Transfer benchmark baseline verifier failed.'
});

const row = createScoreboardRow({
  contract,
  metrics: {
    verificationIntegrity: allVerifiersOk ? 1 : 0,
    autonomyWindowMinutes: durationMinutes,
    truthIntegrityContradictions: 0,
    fakeGreenIncidents: 0
  },
  outcome: { pass: false },
  durationMinutes,
  blockerFamily: allVerifiersOk ? 'baseline_ready_not_scored' : 'verifier_failure',
  blockerSemantics: allVerifiersOk ? 'baseline_ready' : 'blocking',
  notes: allVerifiersOk
    ? 'Baseline verifier run passed. This row is readiness-only and does not count as a scored orchestration benchmark pass.'
    : 'Baseline verifier run failed. Benchmark repo or verifier must be repaired before orchestration execution.'
});
writeJson(path.join(artifactRoot, 'scoreboard_row.json'), row);
const scoreboard = upsertBenchmarkScoreboardRow({ scoreboardPath, row });

console.log(JSON.stringify({
  ok: allVerifiersOk,
  baselineReady,
  thresholdPass,
  contractPath,
  artifactRoot,
  scoreboardPath,
  rowCount: scoreboard.rows.length,
  durationMinutes,
  failedVerifierCount: verifierExecutions.filter((entry) => !entry.execution.ok).length
}, null, 2));

process.exit(allVerifiersOk ? 0 : 1);
