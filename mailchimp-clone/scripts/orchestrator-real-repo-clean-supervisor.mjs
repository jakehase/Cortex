import fs from 'node:fs';
import path from 'node:path';
import { loadContract } from '../../large-project-capability-stack/packages/task-contract/index.mjs';
import { loadGraph, saveGraph, setIssueStatus, summarizeGraph } from '../../large-project-capability-stack/packages/issue-dag/index.mjs';
import { compileSurfaceMatrix, deriveSupervisorTruth, saveMatrix } from '../../large-project-capability-stack/packages/surface-matrix/index.mjs';
import { recoverCampaign, setSupervisor } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { paths, surfaceDefinitions, readJson, RUNS_DIR, writeJson } from './lib/orchestrator-real-repo-clean-plan.mjs';

function exists(filePath) {
  return fs.existsSync(filePath);
}

function tierDir(tier) {
  return path.join(RUNS_DIR, `tier-${String(tier).padStart(3, '0')}`);
}

function loadTierRun(tier) {
  const runRoot = tierDir(tier);
  const summary = readJson(path.join(runRoot, 'summary.json'), null);
  const supervisor = readJson(path.join(runRoot, 'supervisor.json'), null);
  const leaseState = readJson(path.join(runRoot, 'lease_state.json'), null);
  const patchQueue = readJson(path.join(runRoot, 'patch_queue.json'), null);
  const artifactBus = readJson(path.join(runRoot, 'artifact_bus.json'), null);
  const workerEvents = readJson(path.join(runRoot, 'worker_events.json'), null);
  if (!summary || !supervisor) return null;
  return { tier, runRoot, summary, supervisor, leaseState, patchQueue, artifactBus, workerEvents };
}

function discoverTierRuns() {
  if (!exists(RUNS_DIR)) return [];
  return fs.readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^tier-\d+$/.test(entry.name))
    .map((entry) => Number(entry.name.replace('tier-', '')))
    .sort((a, b) => a - b)
    .map(loadTierRun)
    .filter(Boolean);
}

function repoTestStatus(validationIndex, tier) {
  return validationIndex?.perTierRepoTests?.find((entry) => entry.tier === tier) || null;
}

function makeMergeReport(run, selectedTier) {
  return {
    generatedAt: new Date().toISOString(),
    selectedTier,
    runRoot: run.runRoot,
    mergedPatchCount: run.patchQueue?.merged?.length || 0,
    rejectedPatchCount: run.patchQueue?.rejected?.length || 0,
    merged: run.patchQueue?.merged || [],
    rejected: run.patchQueue?.rejected || []
  };
}

function makeRecoveryReport(run, selectedTier) {
  return {
    generatedAt: new Date().toISOString(),
    selectedTier,
    runRoot: run.runRoot,
    recoveryCount: run.summary?.metrics?.recoveryCount || 0,
    staleLeaseCount: run.summary?.metrics?.staleLeaseCount || 0,
    stateLossEvents: run.summary?.metrics?.stateLossEvents || 0,
    continuityFailures: run.summary?.metrics?.continuityFailures || []
  };
}

const contract = loadContract(paths.contract);
let graph = loadGraph(paths.issueGraph);
const validationIndex = readJson(paths.validationIndex, null) || { baseline: null, perTierRepoTests: [], finalSmoke: null, finalRepoTests: null };
const tierRuns = discoverTierRuns();
const attemptedTiers = tierRuns.map((run) => run.tier);
const passingRuns = tierRuns.filter((run) => {
  const repoTests = repoTestStatus(validationIndex, run.tier);
  return Boolean(repoTests?.ok) && run.supervisor?.topLevel?.status === 'green';
});
const highestPassingRun = passingRuns.at(-1) || null;
const lastAttemptedRun = tierRuns.at(-1) || null;
const runForArtifacts = highestPassingRun || lastAttemptedRun || null;
const highestPassingTier = highestPassingRun?.tier || null;
const selectedTier = runForArtifacts?.tier || null;

if (runForArtifacts) {
  writeJson(paths.selectedTierSupervisor, runForArtifacts.supervisor);
  writeJson(paths.selectedTierSummary, runForArtifacts.summary);
  writeJson(paths.leaseState, runForArtifacts.leaseState || { generatedAt: new Date().toISOString(), history: [] });
  writeJson(paths.patchQueueReport, runForArtifacts.patchQueue || { merged: [], rejected: [] });
  writeJson(paths.artifactBus, runForArtifacts.artifactBus || { registry: [] });
  writeJson(paths.workerEvents, runForArtifacts.workerEvents || []);
  writeJson(paths.liveExecutionSummary, {
    generatedAt: new Date().toISOString(),
    qualificationMode: 'real_mailchimp_repo_live_worker_farm',
    selectedTier,
    shardCount: runForArtifacts.summary?.shardCount || 0,
    mergedShardCount: runForArtifacts.summary?.mergedShardCount || 0,
    executionMode: runForArtifacts.summary?.executionMode || 'real_mailchimp_repo_live_worker_farm',
    runRoot: runForArtifacts.runRoot,
    frontier: runForArtifacts.summary?.frontier || null,
    metrics: runForArtifacts.summary?.metrics || null
  });
  writeJson(paths.mergeReport, makeMergeReport(runForArtifacts, selectedTier));
  writeJson(paths.recoveryReport, makeRecoveryReport(runForArtifacts, selectedTier));
}

const finalSmoke = validationIndex.finalSmoke || { ok: false, command: 'node scripts/smoke-full-clone.mjs', logPath: path.join(path.dirname(paths.validationIndex), 'final_smoke.log'), durationMs: 0 };
const finalRepoTests = validationIndex.finalRepoTests || { ok: false, command: 'npm test -- --runInBand', logPath: path.join(path.dirname(paths.validationIndex), 'final_repo_tests.log'), durationMs: 0 };

const scaleQualification = {
  generatedAt: new Date().toISOString(),
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  provenCoordinationScaleTier: highestPassingTier,
  realRepoLive: {
    attemptedTiers,
    highestPassingTier,
    repoIntegrity: {
      baselineRepoTestsOk: Boolean(validationIndex.baseline?.ok),
      finalRepoTestsOk: Boolean(finalRepoTests.ok),
      finalSmokeOk: Boolean(finalSmoke.ok)
    },
    honestResult: highestPassingTier ? `Highest honestly proven coordination tier on cleaned baseline: ${highestPassingTier}` : null,
    stopReason: highestPassingTier && finalSmoke.ok && finalRepoTests.ok
      ? `Qualification completed cleanly at tier ${highestPassingTier}.`
      : highestPassingTier
        ? `Qualification reached tier ${highestPassingTier}, but final smoke/final repo tests did not complete successfully.`
        : 'No clean-baseline live tier was honestly proven.'
  }
};
writeJson(paths.scaleQualification, scaleQualification);

const selectedTierSupervisor = readJson(paths.selectedTierSupervisor, null);
const selectedTierSummary = readJson(paths.selectedTierSummary, null);
const leaseState = readJson(paths.leaseState, null);
const patchQueue = readJson(paths.patchQueueReport, null);
const mergeReport = readJson(paths.mergeReport, null);
const recoveryReport = readJson(paths.recoveryReport, null);
const contextPacks = readJson(paths.contextPacks, []);
const shardPlan = readJson(paths.shardPlan, null);
const priorBlockerReport = readJson(paths.blockerReport, null);

const stageFlags = {
  contract_compiled: Boolean(contract.replyAnchor && contract.anchor && contract.targetPath),
  real_repo_slice_compiled: Boolean(shardPlan?.summary?.shardCount >= 120 && Array.isArray(contextPacks) && contextPacks.length === shardPlan?.shards?.length),
  live_worker_selected_tier_green: Boolean(selectedTierSupervisor?.topLevel?.status === 'green' && selectedTierSummary?.agentCount >= 8),
  zero_state_loss: Boolean((selectedTierSummary?.metrics?.stateLossEvents || 0) === 0 && (recoveryReport?.stateLossEvents || 0) === 0),
  bounded_ownership_conflicts: Boolean((patchQueue?.rejected?.length || 0) === 0 && (mergeReport?.rejectedPatchCount || 0) === 0),
  staged_ladder_honest: Boolean(attemptedTiers[0] === 8 && highestPassingTier !== null),
  repo_integrity_green: Boolean(validationIndex.baseline?.ok && finalRepoTests.ok && finalSmoke.ok),
  selected_artifacts_present: Boolean(leaseState?.history && patchQueue && Array.isArray(contextPacks) && contextPacks.length >= 120),
  supervisor_outputs_present: true
};

const derivedBlocker = (!highestPassingTier
  ? {
      blocker: 'No clean-baseline live tier was honestly proven.',
      nextAction: 'Inspect the first attempted tier under artifacts/qualification/orchestrator_real_repo_clean_baseline/live_runs and repair worker/verifier failures before rerunning.'
    }
  : !finalSmoke.ok || !finalRepoTests.ok
    ? {
        blocker: 'Clean-baseline qualification reached a passing tier, but final smoke/final repo tests did not complete successfully.',
        nextAction: 'Inspect validation files under artifacts/qualification/orchestrator_real_repo_clean_baseline/validation and rerun the clean orchestrator after fixing finalization.'
      }
    : !stageFlags.zero_state_loss
      ? {
          blocker: 'State loss or continuity failure was observed during the selected clean-baseline live tier.',
          nextAction: 'Inspect recovery and selected tier artifacts and fix continuity loss before rerunning.'
        }
      : null);
const blocker = derivedBlocker || null;

const greenComplete = !blocker && Object.values(stageFlags).every(Boolean);
if (greenComplete) {
  graph = setIssueStatus(graph, 'q5.supervisor_state', 'complete', [paths.programState, paths.completionSummary, paths.notificationState, paths.supervisorStatus]);
} else {
  graph = setIssueStatus(graph, 'q5.supervisor_state', blocker ? 'blocked' : 'pending', [paths.programState, paths.completionSummary, paths.notificationState, paths.supervisorStatus]);
}
if (stageFlags.contract_compiled && stageFlags.real_repo_slice_compiled) graph = setIssueStatus(graph, 'q1.real_repo_parallel_slice', 'complete', [paths.contract, paths.workGraph, paths.shardPlan, paths.contextPacks, paths.verifierCatalog]);
else graph = setIssueStatus(graph, 'q1.real_repo_parallel_slice', blocker ? 'blocked' : 'pending', [paths.contract, paths.workGraph, paths.shardPlan, paths.contextPacks, paths.verifierCatalog]);
if (stageFlags.live_worker_selected_tier_green) graph = setIssueStatus(graph, 'q2.live_worker_execution', 'complete', [paths.liveExecutionSummary, paths.leaseState, paths.patchQueueReport, paths.mergeReport, paths.recoveryReport]);
else graph = setIssueStatus(graph, 'q2.live_worker_execution', blocker ? 'blocked' : 'pending', [paths.liveExecutionSummary, paths.leaseState, paths.patchQueueReport, paths.mergeReport, paths.recoveryReport]);
if (stageFlags.staged_ladder_honest) graph = setIssueStatus(graph, 'q3.staged_scale_ladder', 'complete', [paths.scaleQualification, paths.selectedTierSupervisor, paths.selectedTierSummary]);
else graph = setIssueStatus(graph, 'q3.staged_scale_ladder', blocker ? 'blocked' : 'pending', [paths.scaleQualification]);
if (stageFlags.repo_integrity_green) graph = setIssueStatus(graph, 'q4.repo_integrity', 'complete', [paths.validationIndex]);
else graph = setIssueStatus(graph, 'q4.repo_integrity', blocker ? 'blocked' : 'pending', [paths.validationIndex]);

saveGraph(paths.issueGraph, graph);
let matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(paths.surfaceMatrix, matrix);
let truth = deriveSupervisorTruth(matrix);
const graphSummary = summarizeGraph(graph);

recoverCampaign(paths.campaignState, {
  contractPath: paths.contract,
  graphPath: paths.issueGraph,
  matrixPath: paths.surfaceMatrix
});
const campaignState = setSupervisor(paths.campaignState, {
  status: greenComplete && truth.supervisorStatus === 'green' ? 'green' : 'red',
  blocker: blocker || null,
  matrixStatus: matrix.status,
  note: greenComplete
    ? 'cleaned-baseline real repo orchestrator qualification reached supervisor-green completion with honest tier reporting'
    : 'cleaned-baseline real repo orchestrator qualification stopped with blocker or partial truth state'
});

const programState = {
  generatedAt: new Date().toISOString(),
  supervisorStatus: greenComplete && truth.supervisorStatus === 'green' ? 'green' : 'red',
  allComplete: greenComplete && truth.supervisorStatus === 'green',
  matrixPath: paths.surfaceMatrix,
  matrixStatus: matrix.status,
  provenCoordinationScaleTier: highestPassingTier,
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  stopReason: scaleQualification.realRepoLive.stopReason,
  graphSummary,
  stages: Object.entries(stageFlags).map(([id, complete]) => ({ id, complete })),
  evidence: {
    contract: paths.contract,
    graph: paths.issueGraph,
    workGraph: paths.workGraph,
    shardPlan: paths.shardPlan,
    contextPacks: paths.contextPacks,
    validationIndex: paths.validationIndex,
    scaleQualification: paths.scaleQualification,
    selectedTierSupervisor: paths.selectedTierSupervisor,
    selectedTierSummary: paths.selectedTierSummary,
    leaseState: paths.leaseState,
    patchQueueReport: paths.patchQueueReport,
    mergeReport: paths.mergeReport,
    recoveryReport: paths.recoveryReport,
    blockerReport: blocker ? paths.blockerReport : null
  },
  blocker: blocker || null,
  campaignState
};

const completionSummary = {
  generatedAt: new Date().toISOString(),
  supervisorConfirmedCompletion: programState.supervisorStatus === 'green' && matrix.status === 'all_complete',
  supervisorStatus: programState.supervisorStatus,
  surfaceMatrixPath: paths.surfaceMatrix,
  surfaceMatrixStatus: matrix.status,
  targetPath: contract.targetPath,
  provenCoordinationScaleTier: highestPassingTier,
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  replyAnchor: contract.replyAnchor,
  blocker: blocker || null,
  stopReason: scaleQualification.realRepoLive.stopReason,
  stages: programState.stages
};

const notificationState = {
  delivered: false,
  deliveredAt: null,
  awaitingNotifier: completionSummary.supervisorConfirmedCompletion,
  supervisorStatus: completionSummary.supervisorStatus,
  provenCoordinationScaleTier: highestPassingTier,
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  note: completionSummary.supervisorConfirmedCompletion ? 'ready for requester relay' : 'blocked or partial; requester relay should include blocker status'
};

writeJson(paths.programState, programState);
writeJson(paths.completionSummary, completionSummary);
writeJson(paths.notificationState, notificationState);
writeJson(paths.supervisorStatus, {
  generatedAt: new Date().toISOString(),
  truth,
  supervisorStatus: completionSummary.supervisorStatus,
  surfaceMatrixStatus: matrix.status,
  provenCoordinationScaleTier: highestPassingTier,
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  stages: programState.stages,
  blocker: blocker || null,
  stopReason: scaleQualification.realRepoLive.stopReason
});
if (blocker) {
  writeJson(paths.blockerReport, blocker);
} else if (exists(paths.blockerReport)) {
  fs.unlinkSync(paths.blockerReport);
}

console.log(JSON.stringify({
  supervisorStatus: completionSummary.supervisorStatus,
  matrixStatus: matrix.status,
  provenCoordinationScaleTier: highestPassingTier,
  blocker: blocker || null
}, null, 2));
process.exit(completionSummary.supervisorStatus === 'green' ? 0 : 1);
