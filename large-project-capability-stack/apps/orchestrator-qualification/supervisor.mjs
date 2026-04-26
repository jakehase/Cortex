import fs from 'node:fs';
import { loadContract } from '../../packages/task-contract/index.mjs';
import { loadGraph, summarizeGraph } from '../../packages/issue-dag/index.mjs';
import { compileSurfaceMatrix, deriveSupervisorTruth, saveMatrix } from '../../packages/surface-matrix/index.mjs';
import { recoverCampaign, setSupervisor } from '../../packages/campaign-runtime/index.mjs';
import { loadJson } from '../../packages/multi-agent-orchestrator/index.mjs';
import { ARTIFACT_ROOT, REPORTS_DIR, VALIDATION_DIR, paths, surfaceDefinitions } from './plan.mjs';

const contract = loadContract(paths.contract);
const graph = loadGraph(paths.graph);
const matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(paths.matrix, matrix);
const truth = deriveSupervisorTruth(matrix);
const graphSummary = summarizeGraph(graph);
const shardPlan = loadJson(paths.shardPlan, null);
const leaseState = loadJson(paths.leaseState, null);
const contextPacks = loadJson(paths.contextPacks, []);
const patchQueue = loadJson(paths.patchQueue, null);
const supervisorModel = loadJson(paths.supervisorModel, null);
const artifactBus = loadJson(paths.artifactBus, null);
const liveExecution = loadJson(paths.liveExecution, null);
const recovery = loadJson(paths.recovery, null);
const scaleQualification = loadJson(paths.scaleQualification, null);
const qualificationSummary = loadJson(paths.qualificationSummary, null);
const verifierCatalog = loadJson(paths.verifierCatalog, null);
const blockerReport = loadJson(paths.blockerReport, null);

const highestLivePassingTier = scaleQualification?.live?.highestPassingTier || null;
const explicitUnprovenTiers = scaleQualification?.live?.explicitUnprovenTiers || [];
const hasLiveTierBeyond32 = Number.isFinite(highestLivePassingTier) && highestLivePassingTier >= 64;
const hasHonest100Statement = highestLivePassingTier === 100 || explicitUnprovenTiers.includes(100);
const repoTestsLogPresent = fs.existsSync(`${VALIDATION_DIR}/repo_tests.log`);

const stageFlags = {
  contract_compiled: Boolean(contract.anchor && contract.targetPath && contract.replyAnchor),
  b1_large_shard_corpus: Boolean(shardPlan?.summary?.shardCount >= 120 && shardPlan?.summary?.maxReadyCount >= 100),
  b2_live_worker_mode: Boolean(liveExecution?.executionMode === 'live_multiprocess_worker_farm' && Array.isArray(loadJson(paths.workerEvents, [])) && loadJson(paths.workerEvents, []).some((event) => event.type === 'live_worker_spawned')),
  b3_real_verifier_hooks: Boolean(verifierCatalog?.verifiers?.length === 3 && liveExecution?.verifierCommandCount >= 300 && verifierCatalog.verifiers.every((entry) => entry.command.includes('fixture-verifier.mjs'))),
  b4_failure_recovery_verified: Boolean(recovery?.ok === true && recovery?.staleLeaseCount >= 1 && recovery?.recoveryCount >= 1 && recovery?.continuityFailures?.length === 0),
  b5_scale_ladder_updated: Boolean(scaleQualification?.baseline?.provenCoordinationScaleTier >= 32 && hasLiveTierBeyond32 && hasHonest100Statement),
  b6_final_state_present: fs.existsSync(paths.programState) && fs.existsSync(paths.completionSummary) && fs.existsSync(paths.notification) && fs.existsSync(paths.finalReport),
  repo_tests_log_present: repoTestsLogPresent,
  live_supervisor_green: supervisorModel?.topLevel?.status === 'green',
  artifact_bus_present: Boolean(artifactBus?.registry?.length >= 240 && artifactBus?.events?.length >= 240),
  patch_queue_present: Boolean(patchQueue?.merged?.length >= 120),
  context_pack_compiler_present: Array.isArray(contextPacks) && contextPacks.length >= 120 && contextPacks.every((pack) => pack.guardrails?.avoidWholeProjectPromptDump === true),
  lease_manager_present: Boolean(leaseState?.history?.length >= 120)
};

const stages = Object.entries(stageFlags).map(([id, complete]) => ({ id, complete }));
const allComplete = truth.supervisorStatus === 'green' && stages.every((stage) => stage.complete);
const needsBlocker = !allComplete && (!hasLiveTierBeyond32 || !hasHonest100Statement);
const derivedBlocker = needsBlocker ? {
  blocker: blockerReport?.blocker || 'Live qualification did not honestly prove a scale tier beyond 32 agents.',
  nextAction: blockerReport?.nextAction || 'Inspect live tier artifacts, fix failures, and rerun the qualification ladder.',
  highestLivePassingTier,
  explicitUnprovenTiers
} : null;

recoverCampaign(paths.campaign, { contractPath: paths.contract, graphPath: paths.graph, matrixPath: paths.matrix, ledgerPath: paths.ledger });
const campaignState = setSupervisor(paths.campaign, {
  status: allComplete ? 'green' : 'red',
  blocker: derivedBlocker,
  matrixStatus: matrix.status,
  note: allComplete
    ? 'orchestrator supervisor derived truth from B1-B6 matrix plus live qualification checks'
    : 'orchestrator supervisor found live qualification incomplete or blocked'
});

const programState = {
  generatedAt: new Date().toISOString(),
  supervisorStatus: allComplete ? 'green' : 'red',
  allComplete,
  matrixPath: paths.matrix,
  matrixStatus: matrix.status,
  graphSummary,
  stages,
  provenCoordinationScaleTier: scaleQualification?.provenCoordinationScaleTier || null,
  qualificationMode: scaleQualification?.qualificationMode || null,
  evidence: {
    contractPath: paths.contract,
    graphPath: paths.graph,
    shardPlan: paths.shardPlan,
    leaseState: paths.leaseState,
    contextPacks: paths.contextPacks,
    patchQueue: paths.patchQueue,
    supervisorModel: paths.supervisorModel,
    artifactBus: paths.artifactBus,
    liveExecution: paths.liveExecution,
    recovery: paths.recovery,
    scaleQualification: paths.scaleQualification,
    qualificationSummary: paths.qualificationSummary,
    finalReport: paths.finalReport,
    blockerReport: fs.existsSync(paths.blockerReport) ? paths.blockerReport : null
  },
  qualificationSummary,
  blocker: derivedBlocker,
  campaignState
};
const completionSummary = {
  generatedAt: new Date().toISOString(),
  supervisorConfirmedCompletion: allComplete,
  supervisorStatus: programState.supervisorStatus,
  surfaceMatrixPath: paths.matrix,
  surfaceMatrixStatus: matrix.status,
  targetPath: contract.targetPath,
  provenCoordinationScaleTier: scaleQualification?.provenCoordinationScaleTier || null,
  qualificationMode: scaleQualification?.qualificationMode || null,
  stages,
  blocker: derivedBlocker
};
const notificationState = loadJson(paths.notification, {
  delivered: false,
  deliveredAt: null,
  awaitingNotifier: allComplete,
  supervisorStatus: programState.supervisorStatus,
  provenCoordinationScaleTier: scaleQualification?.provenCoordinationScaleTier || null,
  qualificationMode: scaleQualification?.qualificationMode || null
});
notificationState.awaitingNotifier = allComplete;
notificationState.supervisorStatus = programState.supervisorStatus;
notificationState.provenCoordinationScaleTier = scaleQualification?.provenCoordinationScaleTier || null;
notificationState.qualificationMode = scaleQualification?.qualificationMode || null;

fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
fs.mkdirSync(REPORTS_DIR, { recursive: true });
fs.writeFileSync(paths.programState, JSON.stringify(programState, null, 2));
fs.writeFileSync(paths.completionSummary, JSON.stringify(completionSummary, null, 2));
fs.writeFileSync(paths.notification, JSON.stringify(notificationState, null, 2));
fs.writeFileSync(paths.supervisorStatus, JSON.stringify({ truth, stages, provenCoordinationScaleTier: scaleQualification?.provenCoordinationScaleTier || null, qualificationMode: scaleQualification?.qualificationMode || null, blocker: derivedBlocker }, null, 2));

console.log(JSON.stringify({
  supervisorStatus: programState.supervisorStatus,
  matrixStatus: matrix.status,
  allComplete,
  provenCoordinationScaleTier: scaleQualification?.provenCoordinationScaleTier || null,
  qualificationMode: scaleQualification?.qualificationMode || null,
  blocker: derivedBlocker
}, null, 2));
process.exit(allComplete ? 0 : 1);
