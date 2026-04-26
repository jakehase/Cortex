#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { runLiveWorkerFarm } from '../../packages/multi-agent-orchestrator/index.mjs';
import {
  createScoreboardRow,
  deriveBenchmarkAutonomyMetrics,
  evaluateBenchmarkThresholds,
  resolveBenchmarkLeaseTtlMs,
  resolveBenchmarkMaxRuntimeMs,
  upsertBenchmarkScoreboardRow
} from '../../packages/system-benchmark/index.mjs';

function readJson(targetPath, fallback = null) {
  return fs.existsSync(targetPath) ? JSON.parse(fs.readFileSync(targetPath, 'utf8')) : fallback;
}

function writeJson(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  console.error('usage: node run-transfer-orchestrator-benchmark.mjs <run_contract.json>');
  process.exit(1);
}

function deriveVerifierId(surfaceId, command, index) {
  const normalized = String(command || '').toLowerCase();
  const family = normalized.includes('smoke') ? 'smoke'
    : normalized.includes('lint') ? 'lint'
    : normalized.includes('import') ? 'imports'
    : normalized.includes('test') ? 'tests'
    : 'command';
  return `${surfaceId}__${family}_${index + 1}`;
}

function buildTransferPlan(contract) {
  const verifierCatalog = {};
  const surfaces = contract.scope?.surfaces || [];
  const workUnits = surfaces.map((surface) => {
    const verificationCommands = surface.verification || [];
    const surfaceVerifierCatalog = {};
    const requiredVerifiers = verificationCommands.map((command, index) => {
      const verifierId = deriveVerifierId(surface.id, command, index);
      const entry = {
        id: verifierId,
        command,
        purpose: `Verify ${surface.label}`,
        surfaceId: surface.id,
        allowedFiles: surface.allowedFiles || []
      };
      verifierCatalog[verifierId] = entry;
      surfaceVerifierCatalog[verifierId] = entry;
      return verifierId;
    });
    return {
      id: surface.id,
      title: surface.label,
      goal: `Validate transfer surface ${surface.label}`,
      lane: 'transfer_validation',
      domain: surface.id,
      fileAreas: surface.allowedFiles || [],
      allowedFiles: surface.allowedFiles || [],
      deps: [],
      requiredVerifiers,
      acceptanceChecks: verificationCommands.map((command) => `Verifier passes: ${command}`),
      inputs: {
        verifierCatalog: surfaceVerifierCatalog
      },
      metadata: {
        surfaceId: surface.id,
        artifactKind: 'verification_evidence',
        verifierCatalog: surfaceVerifierCatalog
      }
    };
  });
  return {
    verifierCatalog,
    workGraph: {
      targetPath: contract.repoPath,
      workUnits
    }
  };
}

function createResultBackedVerifierMap(verifierIds) {
  return Object.fromEntries(verifierIds.map((verifierId) => [verifierId, async (patch) => {
    const result = readJson(patch.metadata?.resultPath, null);
    const recorded = result?.verifierResults?.find((entry) => entry.verifier === verifierId);
    if (!recorded) {
      return { ok: false, verifier: verifierId, error: 'verifier_result_missing', resultPath: patch.metadata?.resultPath || null };
    }
    return {
      ok: recorded.ok !== false,
      verifier: verifierId,
      command: recorded.command || null,
      durationMs: recorded.durationMs || 0,
      stdout: recorded.stdout || '',
      stderr: recorded.stderr || '',
      skipped: recorded.skipped === true,
      reason: recorded.reason || null,
      resultPath: patch.metadata?.resultPath || null
    };
  }]));
}

function computePeakConcurrency(events = []) {
  let active = 0;
  let peak = 0;
  for (const event of events) {
    if (event.type === 'live_worker_spawned' || event.type === 'live_worker_respawned') {
      active += 1;
      peak = Math.max(peak, active);
    } else if (event.type === 'live_worker_exit') {
      active = Math.max(0, active - 1);
    }
  }
  return peak;
}

function parseJsonFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const candidate = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .find((line) => line.startsWith('{') || line.startsWith('[')) || raw;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function parseIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function computeMedian(values = []) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2));
}

function deriveMeaningfulProgressEvidence({ contract, liveRun }) {
  const benchmarkStartAt = (() => {
    const firstWorkerSpawn = (liveRun.workerEvents || []).find((event) => event.type === 'live_worker_spawned');
    return parseIsoDate(firstWorkerSpawn?.at) || parseIsoDate(contract.generatedAt) || null;
  })();
  const mergedByShard = new Map((liveRun.patchQueue?.merged || []).map((entry) => [entry.shardId, entry]));
  const surfaces = (contract.scope?.surfaces || []).map((surface) => {
    const merged = mergedByShard.get(surface.id) || null;
    const result = merged?.metadata?.resultPath ? readJson(merged.metadata.resultPath, null) : null;
    const verifierResults = Array.isArray(result?.verifierResults) ? result.verifierResults : [];
    let firstMeaningfulProgressAt = null;
    for (const verifierResult of verifierResults) {
      const metadata = verifierResult?.metadata && typeof verifierResult.metadata === 'object'
        ? verifierResult.metadata
        : {};
      const parsedStdout = parseJsonFromText(verifierResult?.stdout || '');
      const directTimestamp = parseIsoDate(verifierResult?.firstMeaningfulProgressAt)
        || parseIsoDate(metadata.firstMeaningfulProgressAt)
        || parseIsoDate(parsedStdout?.firstMeaningfulProgressAt);
      if (directTimestamp) {
        firstMeaningfulProgressAt = !firstMeaningfulProgressAt || directTimestamp < firstMeaningfulProgressAt
          ? directTimestamp
          : firstMeaningfulProgressAt;
        continue;
      }

      const startedAt = parseIsoDate(verifierResult?.startedAt)
        || parseIsoDate(metadata.startedAt)
        || parseIsoDate(parsedStdout?.startedAt);
      const firstMeaningfulProgressMs = Number(verifierResult?.firstMeaningfulProgressMs || metadata.firstMeaningfulProgressMs || parsedStdout?.firstMeaningfulProgressMs || 0);
      if (startedAt && Number.isFinite(firstMeaningfulProgressMs) && firstMeaningfulProgressMs >= 0) {
        const inferred = new Date(startedAt.getTime() + firstMeaningfulProgressMs);
        firstMeaningfulProgressAt = !firstMeaningfulProgressAt || inferred < firstMeaningfulProgressAt
          ? inferred
          : firstMeaningfulProgressAt;
      }
    }

    const minutesFromBenchmarkStart = benchmarkStartAt && firstMeaningfulProgressAt
      ? Number((((firstMeaningfulProgressAt.getTime() - benchmarkStartAt.getTime()) / 60000)).toFixed(2))
      : null;
    return {
      surfaceId: surface.id,
      resultPath: merged?.metadata?.resultPath || null,
      firstMeaningfulProgressAt: firstMeaningfulProgressAt?.toISOString() || null,
      minutesFromBenchmarkStart
    };
  });

  const measuredMinutes = surfaces
    .map((surface) => surface.minutesFromBenchmarkStart)
    .filter((value) => Number.isFinite(value) && value >= 0);

  return {
    benchmarkStartedAt: benchmarkStartAt?.toISOString() || null,
    measuredSurfaceCount: measuredMinutes.length,
    missingSurfaceCount: surfaces.length - measuredMinutes.length,
    medianMinutesToMeaningfulProgress: computeMedian(measuredMinutes),
    surfaces
  };
}

function deriveTransferEvidence({ contract, liveRun }) {
  const declaredSurfaces = contract.scope?.surfaces || [];
  const requiresRealProductDiffs = contract.scope?.requireRealProductDiffs !== false
    && contract.benchmarkClass !== 'verification_orchestration';
  const mergedByShard = new Map((liveRun.patchQueue?.merged || []).map((entry) => [entry.shardId, entry]));
  const surfaceEvidence = declaredSurfaces.map((surface) => {
    const merged = mergedByShard.get(surface.id) || null;
    const result = merged?.metadata?.resultPath ? readJson(merged.metadata.resultPath, null) : null;
    const verifierResults = Array.isArray(result?.verifierResults) ? result.verifierResults : [];
    const verifierEvidence = verifierResults.map((entry) => {
      const parsedOutput = parseJsonFromText(entry.stdout || '');
      return {
        verifier: entry.verifier || null,
        ok: entry.ok !== false,
        skipped: entry.skipped === true,
        parsedOk: parsedOutput?.ok !== false,
        parsedOutput
      };
    });
    const hasRealFiles = Array.isArray(merged?.filePaths) && merged.filePaths.length > 0;
    const allVerifierEvidenceGreen = verifierEvidence.length > 0 && verifierEvidence.every((entry) => entry.ok && !entry.skipped && entry.parsedOk);
    const verified = Boolean(merged && allVerifierEvidenceGreen);
    const productive = Boolean(verified && (!requiresRealProductDiffs || hasRealFiles));
    return {
      surfaceId: surface.id,
      label: surface.label,
      merged: Boolean(merged),
      hasRealFiles,
      verifierCount: verifierEvidence.length,
      verified,
      productive,
      productivityMode: requiresRealProductDiffs ? 'requires_real_product_diff' : 'verification_orchestration',
      resultPath: merged?.metadata?.resultPath || null,
      verifiers: verifierEvidence
    };
  });

  const verifiedSurfaceCount = surfaceEvidence.filter((entry) => entry.verified).length;
  const productiveSurfaceCount = surfaceEvidence.filter((entry) => entry.productive).length;
  const totalSurfaceCount = surfaceEvidence.length;
  return {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    requiresRealProductDiffs,
    totalSurfaceCount,
    verifiedSurfaceCount,
    productiveSurfaceCount,
    verificationScore: totalSurfaceCount > 0 ? Number((verifiedSurfaceCount / totalSurfaceCount).toFixed(2)) : null,
    transferScore: totalSurfaceCount > 0 ? Number((productiveSurfaceCount / totalSurfaceCount).toFixed(2)) : null,
    surfaces: surfaceEvidence
  };
}

function summarizeSurfaceStatuses(surfaceMatrix, liveRun) {
  const merged = new Set((liveRun.patchQueue?.merged || []).map((entry) => entry.shardId));
  const rejected = new Map((liveRun.patchQueue?.rejected || []).map((entry) => [entry.shardId, entry]));
  return {
    ...surfaceMatrix,
    generatedAt: new Date().toISOString(),
    status: merged.size === (surfaceMatrix.surfaces || []).length ? 'orchestrator_green' : 'blocked',
    surfaces: (surfaceMatrix.surfaces || []).map((surface) => ({
      ...surface,
      status: merged.has(surface.id) ? 'verified' : rejected.has(surface.id) ? 'rejected' : 'unverified',
      merged: merged.has(surface.id),
      rejectionCategory: rejected.get(surface.id)?.rejectionCategory || null,
      rejectionReason: rejected.get(surface.id)?.rejectionReason || null
    }))
  };
}

function collectTruthContradictions({ liveRun, shardCount, mergedShardCount }) {
  const contradictions = [];
  const supervisorStatus = liveRun.supervisor?.topLevel?.status || 'red';
  const counts = liveRun.supervisor?.topLevel?.counts || {};
  const incompleteCount = Number(counts.ready || 0) + Number(counts.pending || 0) + Number(counts.in_progress || 0) + Number(counts.blocked || 0);
  const completeCount = Number(counts.complete || 0);

  if (supervisorStatus === 'green' && (mergedShardCount !== shardCount || incompleteCount > 0 || completeCount !== shardCount)) {
    contradictions.push({
      type: 'supervisor_green_with_unfinished_shards',
      supervisorStatus,
      shardCount,
      mergedShardCount,
      counts
    });
  }

  return contradictions;
}

const contractPath = path.resolve(process.argv[2] || '');
if (!contractPath || !fs.existsSync(contractPath)) usage();

const contract = readJson(contractPath);
const artifactRoot = path.resolve(contract.artifactRoot);
const scoreboardPath = path.resolve(contract.scoreboardPath);
const surfaceMatrixPath = path.join(artifactRoot, 'surface_matrix.json');
const surfaceMatrix = readJson(surfaceMatrixPath, { surfaces: [] });
const orchestratorRunRoot = path.join(artifactRoot, 'orchestrator_run');
const previousCompletion = readJson(path.join(artifactRoot, 'completion_summary.json'), {});
const previousBaselineReady = previousCompletion?.baselineReady ?? null;
const { verifierCatalog, workGraph } = buildTransferPlan(contract);
const verifierIds = Object.keys(verifierCatalog);
const maxRuntimeMs = resolveBenchmarkMaxRuntimeMs({ scope: contract.scope, env: process.env });
const leaseTtlMs = resolveBenchmarkLeaseTtlMs({ scope: contract.scope, env: process.env, maxRuntimeMs });
const hostRole = process.env.BENCHMARK_HOST_ROLE || process.env.HOST_ROLE || 'control_plane';
const hostname = process.env.HOSTNAME || null;

if (contract.executionBoundary === 'remote_execution_required' && hostRole !== 'execution_plane') {
  const blocker = {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    phase: 'boundary_preflight',
    status: 'blocked',
    blocker: 'This orchestrator benchmark requires execution on the execution plane, but it was launched from a control-plane host.',
    nextAction: 'Run the orchestrator benchmark on VM102 with BENCHMARK_HOST_ROLE=execution_plane, while CT101 remains the supervisor/notifier control plane.',
    observedHostRole: hostRole,
    observedHostname: hostname,
    requiredHostRole: 'execution_plane'
  };
  writeJson(path.join(artifactRoot, 'blocker_report.json'), blocker);
  writeJson(path.join(artifactRoot, 'supervisor_status.json'), {
    generatedAt: blocker.generatedAt,
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    supervisorStatus: 'red',
    matrixStatus: 'blocked',
    note: blocker.blocker
  });
  writeJson(path.join(artifactRoot, 'program_state.json'), {
    schemaVersion: 'claw.agent_benchmark_program_state.v1',
    generatedAt: blocker.generatedAt,
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    status: 'blocked',
    done: true,
    stopAllowed: true,
    stopReason: 'execution_boundary_blocked',
    summary: blocker.blocker
  });
  writeJson(path.join(artifactRoot, 'orchestrator_summary.json'), {
    generatedAt: blocker.generatedAt,
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    requestedAgentCount: contract.requestedAgentCount,
    mechanicalGreen: false,
    scaleProofReady: false,
    thresholdPass: false,
    blockedByBoundary: true,
    hostRole,
    hostname
  });
  writeJson(path.join(artifactRoot, 'completion_summary.json'), {
    generatedAt: blocker.generatedAt,
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    baselineReady: previousBaselineReady,
    thresholdPass: false,
    supervisorConfirmedCompletion: false,
    executionMode: 'boundary_preflight_blocked',
    mechanicalGreen: false,
    scaleProofReady: false,
    blocker,
    note: blocker.blocker
  });
  const scoreboardRow = createScoreboardRow({
    contract,
    metrics: {
      verificationIntegrity: previousBaselineReady ? 1 : 0,
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
  writeJson(path.join(artifactRoot, 'scoreboard_row.json'), scoreboardRow);
  upsertBenchmarkScoreboardRow({ scoreboardPath, row: scoreboardRow });
  console.log(JSON.stringify({ ok: false, blocker: blocker.blocker, hostRole, hostname }, null, 2));
  process.exit(2);
}

if (!workGraph.workUnits.length || !verifierIds.length) {
  const blocker = {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    phase: 'transfer_orchestrator_runner',
    status: 'blocked',
    blocker: 'Transfer benchmark contract has no runnable surfaces/verifiers.',
    nextAction: 'Add at least one surface with at least one verification command, then rerun the orchestrator benchmark.'
  };
  writeJson(path.join(artifactRoot, 'blocker_report.json'), blocker);
  writeJson(path.join(artifactRoot, 'completion_summary.json'), {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    baselineReady: previousBaselineReady,
    thresholdPass: false,
    supervisorConfirmedCompletion: false,
    executionMode: 'transfer_orchestrator_live_worker_farm',
    blocker,
    note: blocker.blocker
  });
  console.log(JSON.stringify({ ok: false, blocker: blocker.blocker }, null, 2));
  process.exit(2);
}

let liveRun;
try {
  if (process.env.TRANSFER_BENCHMARK_TEST_FORCE_CRASH === '1') {
    throw new Error('Forced orchestrator benchmark crash for test coverage.');
  }
  liveRun = await runLiveWorkerFarm({
    workGraph,
    surfaceMatrix,
    agentCount: Math.max(1, Number(contract.requestedAgentCount || 1)),
    workerScriptPath: path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), 'live-transfer-worker.mjs')),
    verifierScriptPath: path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), 'live-transfer-verifier.mjs')),
    workspacePath: path.resolve(contract.repoPath),
    runRoot: orchestratorRunRoot,
    maxRuntimeMs,
    leaseTtlMs,
    plannerOptions: {
      maxFileAreasPerShard: 16,
      maxFilesPerShard: 16,
      maxAcceptanceChecksPerShard: 16
    },
    globalInputs: {
      verifierCatalog
    },
    verifyFns: createResultBackedVerifierMap(verifierIds),
    executionMode: 'transfer_orchestrator_live_worker_farm',
    campaignContract: {
      fidelity: contract.fidelity,
      requestedScope: (contract.scope?.surfaces || []).map((surface) => surface.id),
      repoPath: contract.repoPath,
      targetPath: contract.repoPath
    }
  });
} catch (error) {
  const blocker = {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    phase: 'transfer_orchestrator_runner',
    status: 'blocked',
    blocker: 'The orchestrated transfer run crashed before it could finalize benchmark artifacts.',
    nextAction: 'Inspect orchestrator_run logs and crash details, repair the execution failure, then rerun the orchestrator benchmark.',
    crash: {
      name: error?.name || 'Error',
      message: error?.message || String(error),
      stack: typeof error?.stack === 'string' ? error.stack.split('\n').slice(0, 12) : []
    }
  };

  writeJson(path.join(artifactRoot, 'orchestrator_summary.json'), {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    requestedAgentCount: contract.requestedAgentCount,
    mechanicalGreen: false,
    scaleProofReady: false,
    thresholdPass: false,
    crashed: true,
    crashMessage: blocker.crash.message,
    liveRunSummaryPath: path.join(orchestratorRunRoot, 'summary.json')
  });
  writeJson(path.join(artifactRoot, 'blocker_report.json'), blocker);
  writeJson(path.join(artifactRoot, 'supervisor_status.json'), {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    supervisorStatus: 'red',
    matrixStatus: 'blocked',
    note: blocker.blocker
  });
  writeJson(path.join(artifactRoot, 'program_state.json'), {
    schemaVersion: 'claw.agent_benchmark_program_state.v1',
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    status: 'blocked',
    done: true,
    stopAllowed: true,
    stopReason: 'runner_crash_blocker_report_written',
    summary: blocker.blocker
  });
  writeJson(path.join(artifactRoot, 'notifier_eligibility.json'), {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    eligible: true,
    kind: 'blocker',
    note: blocker.blocker
  });
  writeJson(path.join(artifactRoot, 'completion_summary.json'), {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    baselineReady: previousBaselineReady,
    thresholdPass: false,
    supervisorConfirmedCompletion: false,
    executionMode: 'transfer_orchestrator_live_worker_farm',
    mechanicalGreen: false,
    scaleProofReady: false,
    blocker,
    note: blocker.blocker
  });

  console.log(JSON.stringify({
    ok: false,
    crashed: true,
    artifactRoot,
    runRoot: orchestratorRunRoot,
    blocker
  }, null, 2));
  process.exit(1);
}

const shardCount = liveRun.shardPlan?.shards?.length || 0;
const mergedShardCount = liveRun.patchQueue?.merged?.length || 0;
const durationEvidence = deriveBenchmarkAutonomyMetrics({ elapsedMs: liveRun.summary?.elapsedMs || 0, scope: contract.scope });
const elapsedMinutes = durationEvidence.elapsedMinutes;
const peakConcurrency = computePeakConcurrency(liveRun.workerEvents || []);
const mechanicalGreen = Boolean(liveRun.ok && liveRun.supervisor?.topLevel?.status === 'green' && mergedShardCount === shardCount);
const scaleProofReady = shardCount >= Number(contract.requestedAgentCount || 1) && peakConcurrency >= Math.min(shardCount, Number(contract.requestedAgentCount || 1));
const truthContradictions = collectTruthContradictions({ liveRun, shardCount, mergedShardCount });
const transferEvidence = deriveTransferEvidence({ contract, liveRun });
const meaningfulProgressEvidence = deriveMeaningfulProgressEvidence({ contract, liveRun });
const productiveSurfaceCount = Number(transferEvidence.productiveSurfaceCount || 0);
const verifiedSurfaceCount = Number(transferEvidence.verifiedSurfaceCount || 0);
const metrics = {
  productiveIterationRate: shardCount > 0 ? Number((productiveSurfaceCount / shardCount).toFixed(2)) : null,
  noOpRate: shardCount > 0 ? Number((((shardCount - productiveSurfaceCount) / shardCount)).toFixed(2)) : null,
  repeatBlockerRate: shardCount > 0 ? Number((((liveRun.metrics?.failedShards?.length || 0) / shardCount)).toFixed(2)) : null,
  medianMinutesToMeaningfulProgress: meaningfulProgressEvidence.medianMinutesToMeaningfulProgress,
  verificationIntegrity: mergedShardCount > 0 ? Number((verifiedSurfaceCount / mergedShardCount).toFixed(2)) : 0,
  handoffEfficiency: shardCount > 0 ? Number((mergedShardCount / shardCount).toFixed(2)) : null,
  autonomyWindowMinutes: durationEvidence.autonomyWindowMinutes,
  truthIntegrityContradictions: truthContradictions.length,
  fakeGreenIncidents: truthContradictions.filter((entry) => entry.type === 'supervisor_green_with_unfinished_shards').length,
  transferScore: transferEvidence.transferScore
};
const thresholdEvaluation = evaluateBenchmarkThresholds({
  benchmarkTier: contract.benchmarkTier,
  metrics
});
const thresholdPass = mechanicalGreen && scaleProofReady && thresholdEvaluation.ok;

let blocker = null;
let blockerFamily = null;
let blockerSemantics = 'none';
if (!mechanicalGreen) {
  blockerFamily = 'orchestrator_failure';
  blockerSemantics = 'blocking';
  blocker = {
    blocker: 'The orchestrated transfer run did not reach a green supervisor outcome.',
    nextAction: 'Inspect orchestrator_run artifacts, repair failed verifier or patch admission issues, then rerun the orchestrator benchmark.'
  };
} else if (!scaleProofReady) {
  blockerFamily = 'insufficient_parallel_surface_inventory';
  blockerSemantics = 'scope_limited';
  blocker = {
    blocker: `The orchestrator run was mechanically green, but it only produced ${shardCount} runnable shard(s) and peak concurrency ${peakConcurrency} for a requested ${contract.requestedAgentCount}-agent benchmark.`,
    nextAction: `Either expand the surface matrix to at least ${contract.requestedAgentCount} independently verifiable low-overlap surfaces/shards or lower requestedAgentCount to the observed benchmarkable scale.`
  };
} else if (!thresholdEvaluation.ok) {
  blockerFamily = 'benchmark_thresholds_unmet';
  blockerSemantics = 'evidence_or_endurance_gap';
  const durationTargetNote = durationEvidence.endedBeforeDurationTarget
    ? `The runnable work graph exhausted in ${elapsedMinutes} minute(s), below the contract duration target of ${durationEvidence.durationTargetMinutes} minute(s).`
    : null;
  blocker = {
    blocker: `The orchestrator run was mechanically green and scale-proven, but it did not satisfy the ${contract.benchmarkTier} benchmark thresholds.`,
    nextAction: durationEvidence.endedBeforeDurationTarget
      ? 'Use or build a benchmark preset that can sustain productive work through the declared duration target, then rerun the benchmark.'
      : 'Address the missing endurance/evidence gaps called out in threshold_evaluation.json, then rerun the benchmark.',
    durationTarget: {
      durationTargetMinutes: durationEvidence.durationTargetMinutes,
      elapsedMinutes,
      durationTargetMet: durationEvidence.durationTargetMet,
      durationTargetGapMinutes: durationEvidence.durationTargetGapMinutes,
      endedBeforeDurationTarget: durationEvidence.endedBeforeDurationTarget,
      note: durationTargetNote
    },
    thresholdFailures: thresholdEvaluation.failures
  };
}

const updatedSurfaceMatrix = summarizeSurfaceStatuses(surfaceMatrix, liveRun);
writeJson(surfaceMatrixPath, updatedSurfaceMatrix);
writeJson(path.join(artifactRoot, 'threshold_evaluation.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  mechanicalGreen,
  scaleProofReady,
  thresholdPass,
  durationTarget: {
    durationTargetMinutes: durationEvidence.durationTargetMinutes,
    elapsedMinutes,
    durationTargetMet: durationEvidence.durationTargetMet,
    durationTargetGapMinutes: durationEvidence.durationTargetGapMinutes,
    endedBeforeDurationTarget: durationEvidence.endedBeforeDurationTarget
  },
  meaningfulProgressEvidence,
  metrics,
  ...thresholdEvaluation
});
writeJson(path.join(artifactRoot, 'orchestrator_summary.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  shardCount,
  mergedShardCount,
  requestedAgentCount: contract.requestedAgentCount,
  peakConcurrency,
  durationTargetMinutes: durationEvidence.durationTargetMinutes,
  elapsedMinutes,
  durationTargetMet: durationEvidence.durationTargetMet,
  endedBeforeDurationTarget: durationEvidence.endedBeforeDurationTarget,
  mechanicalGreen,
  scaleProofReady,
  transferScore: metrics.transferScore,
  thresholdPass,
  thresholdFailures: thresholdEvaluation.failures,
  liveRunSummaryPath: path.join(orchestratorRunRoot, 'summary.json')
});

writeJson(path.join(artifactRoot, 'iteration_ledger.json'), (liveRun.workerEvents || []).map((event, index) => ({ index: index + 1, ...event })));
writeJson(path.join(artifactRoot, 'intervention_log.json'), []);
writeJson(path.join(artifactRoot, 'transfer_evidence.json'), transferEvidence);
writeJson(path.join(artifactRoot, 'meaningful_progress_evidence.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  ...meaningfulProgressEvidence
});
writeJson(path.join(artifactRoot, 'truth_conflicts.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  contradictions: truthContradictions
});
writeJson(path.join(artifactRoot, 'supervisor_status.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  supervisorStatus: liveRun.supervisor?.topLevel?.status || 'red',
  matrixStatus: updatedSurfaceMatrix.status,
  note: thresholdPass
    ? 'Orchestrated transfer benchmark passed.'
    : blocker?.durationTarget?.note || blocker?.blocker || 'Orchestrated transfer benchmark completed without a threshold pass.'
});
writeJson(path.join(artifactRoot, 'program_state.json'), {
  schemaVersion: 'claw.agent_benchmark_program_state.v1',
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  status: thresholdPass ? 'passed' : blocker ? 'blocked' : 'completed',
  done: true,
  stopAllowed: true,
  stopReason: thresholdPass ? 'supervisor_green_scale_proven_and_thresholds_met' : blocker ? 'blocker_report_written' : 'orchestrator_completed',
  summary: thresholdPass
    ? 'Orchestrated transfer benchmark passed.'
    : blocker?.blocker || 'Orchestrated transfer benchmark completed.'
});
writeJson(path.join(artifactRoot, 'notifier_eligibility.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  eligible: true,
  kind: thresholdPass ? 'completion' : 'blocker',
  note: thresholdPass ? 'Benchmark completed with threshold pass.' : blocker?.blocker || 'Benchmark completed.'
});
if (blocker) {
  writeJson(path.join(artifactRoot, 'blocker_report.json'), {
    generatedAt: new Date().toISOString(),
    benchmarkId: contract.benchmarkId,
    runId: contract.runId,
    phase: 'transfer_orchestrator_runner',
    status: 'blocked',
    ...blocker
  });
}

const scoreboardRow = createScoreboardRow({
  contract,
  metrics,
  outcome: {
    pass: thresholdPass,
    mechanicalGreen,
    scaleProofReady,
    thresholdFailures: thresholdEvaluation.failures
  },
  durationMinutes: elapsedMinutes,
  blockerFamily,
  blockerSemantics,
  notes: thresholdPass
    ? `Orchestrated transfer benchmark passed with ${mergedShardCount}/${shardCount} merged shard(s) and peak concurrency ${peakConcurrency}.`
    : blocker?.durationTarget?.note || blocker?.blocker || 'Orchestrated transfer benchmark completed without a threshold pass.'
});
writeJson(path.join(artifactRoot, 'scoreboard_row.json'), scoreboardRow);
const scoreboard = upsertBenchmarkScoreboardRow({ scoreboardPath, row: scoreboardRow });

writeJson(path.join(artifactRoot, 'completion_summary.json'), {
  generatedAt: new Date().toISOString(),
  benchmarkId: contract.benchmarkId,
  runId: contract.runId,
  baselineReady: previousBaselineReady,
  thresholdPass,
  supervisorConfirmedCompletion: mechanicalGreen,
  executionMode: 'transfer_orchestrator_live_worker_farm',
  shardCount,
  mergedShardCount,
  peakConcurrency,
  requestedAgentCount: contract.requestedAgentCount,
  durationMinutes: elapsedMinutes,
  mechanicalGreen,
  scaleProofReady,
  transferScore: metrics.transferScore,
  thresholdFailures: thresholdEvaluation.failures,
  blocker,
  note: thresholdPass
    ? 'Orchestrated transfer benchmark passed.'
    : blocker?.durationTarget?.note || blocker?.blocker || 'Orchestrated transfer benchmark completed without a threshold pass.'
});

console.log(JSON.stringify({
  ok: mechanicalGreen,
  thresholdPass,
  shardCount,
  mergedShardCount,
  peakConcurrency,
  thresholdFailures: thresholdEvaluation.failures,
  scoreboardRows: scoreboard.rows.length,
  artifactRoot,
  runRoot: orchestratorRunRoot,
  blocker
}, null, 2));

process.exit(mechanicalGreen ? 0 : 1);
