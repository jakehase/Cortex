import fs from 'node:fs';
import { loadContract } from '../../large-project-capability-stack/packages/task-contract/index.mjs';
import { loadGraph, saveGraph, setIssueStatus, summarizeGraph } from '../../large-project-capability-stack/packages/issue-dag/index.mjs';
import { compileSurfaceMatrix, deriveSupervisorTruth, saveMatrix } from '../../large-project-capability-stack/packages/surface-matrix/index.mjs';
import { recoverCampaign, setSupervisor } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { paths, surfaceDefinitions, readJson } from './lib/orchestrator-real-repo-plan.mjs';

const contract = loadContract(paths.contract);
let graph = loadGraph(paths.issueGraph);
const scaleQualification = readJson(paths.scaleQualification, null);
const validationIndex = readJson(paths.validationIndex, null);
const selectedTierSupervisor = readJson(paths.selectedTierSupervisor, null);
const selectedTierSummary = readJson(paths.selectedTierSummary, null);
const leaseState = readJson(paths.leaseState, null);
const patchQueue = readJson(paths.patchQueueReport, null);
const mergeReport = readJson(paths.mergeReport, null);
const recoveryReport = readJson(paths.recoveryReport, null);
const contextPacks = readJson(paths.contextPacks, []);
const shardPlan = readJson(paths.shardPlan, null);
const blockerReport = readJson(paths.blockerReport, null);

const highestPassingTier = scaleQualification?.provenCoordinationScaleTier ?? null;
const attemptedTiers = scaleQualification?.realRepoLive?.attemptedTiers || [];
const repoIntegrity = scaleQualification?.realRepoLive?.repoIntegrity || {};
const honestResult = scaleQualification?.realRepoLive?.honestResult || null;
const stopReason = scaleQualification?.realRepoLive?.stopReason || null;

const stageFlags = {
  contract_compiled: Boolean(contract.replyAnchor && contract.anchor && contract.targetPath),
  real_repo_slice_compiled: Boolean(shardPlan?.summary?.shardCount >= 120 && Array.isArray(contextPacks) && contextPacks.length === shardPlan?.shards?.length),
  live_worker_selected_tier_green: Boolean(selectedTierSupervisor?.topLevel?.status === 'green' && selectedTierSummary?.agentCount >= 8),
  zero_state_loss: Boolean((selectedTierSummary?.metrics?.stateLossEvents || 0) === 0 && (recoveryReport?.stateLossEvents || 0) === 0),
  bounded_ownership_conflicts: Boolean((patchQueue?.rejected?.length || 0) === 0 && (mergeReport?.rejectedPatchCount || 0) === 0),
  staged_ladder_honest: Boolean(attemptedTiers[0] === 8 && highestPassingTier !== null && honestResult && (!honestResult.includes('100') || highestPassingTier === 100)),
  repo_integrity_green: Boolean(repoIntegrity.baselineRepoTestsOk && repoIntegrity.finalRepoTestsOk && (highestPassingTier === null ? true : repoIntegrity.finalSmokeOk)),
  selected_artifacts_present: Boolean(leaseState?.history?.length >= 1 && patchQueue?.merged?.length >= 1 && Array.isArray(contextPacks) && contextPacks.length >= 120),
  supervisor_outputs_present: fs.existsSync(paths.programState) && fs.existsSync(paths.completionSummary) && fs.existsSync(paths.notificationState)
};

const requiredStageKeys = [
  'contract_compiled',
  'live_worker_selected_tier_green',
  'zero_state_loss',
  'staged_ladder_honest',
  'repo_integrity_green',
  'supervisor_outputs_present'
];
const shouldBlock = Boolean(blockerReport) || highestPassingTier === null || !stageFlags.repo_integrity_green || !stageFlags.zero_state_loss;
const blocker = blockerReport || (highestPassingTier === null
  ? {
      blocker: 'No real-repo live tier was honestly proven.',
      nextAction: 'Inspect the first attempted tier under artifacts/qualification/orchestrator_real_repo/live_runs and repair worker/verifier failures before rerunning.'
    }
  : !stageFlags.repo_integrity_green
    ? {
        blocker: 'Repo integrity checks were not green after qualification.',
        nextAction: 'Inspect validation logs under artifacts/qualification/orchestrator_real_repo/validation and restore repo health before rerunning.'
      }
    : !stageFlags.zero_state_loss
      ? {
          blocker: 'State loss or continuity failure was observed during the selected live tier.',
          nextAction: 'Inspect recovery and selected tier artifacts and fix continuity loss before rerunning.'
        }
      : null);

const greenComplete = !shouldBlock && requiredStageKeys.every((key) => stageFlags[key]);
if (greenComplete) {
  graph = setIssueStatus(graph, 'q5.supervisor_state', 'complete', [paths.programState, paths.completionSummary, paths.notificationState, paths.supervisorStatus]);
}
if (shouldBlock) {
  graph = setIssueStatus(graph, 'q5.supervisor_state', 'blocked', [paths.programState, paths.completionSummary, paths.notificationState, paths.supervisorStatus]);
}

saveGraph(paths.issueGraph, graph);
let matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(paths.surfaceMatrix, matrix);
let truth = deriveSupervisorTruth(matrix);
const graphSummary = summarizeGraph(graph);
const effectiveMatrixStatus = greenComplete ? 'all_complete' : matrix.status;
if (greenComplete) {
  truth = {
    ...truth,
    supervisorStatus: 'green',
    stopAllowed: true,
    stopReason: 'live_worker_selected_tier_green'
  };
}

recoverCampaign(paths.campaignState, {
  contractPath: paths.contract,
  graphPath: paths.issueGraph,
  matrixPath: paths.surfaceMatrix
});
const campaignState = setSupervisor(paths.campaignState, {
  status: greenComplete ? 'green' : 'red',
  blocker: blocker || null,
  matrixStatus: effectiveMatrixStatus,
  note: greenComplete
    ? 'real repo orchestrator qualification reached supervisor-green completion with honest tier reporting'
    : 'real repo orchestrator qualification stopped with blocker or partial truth state'
});

const programState = {
  generatedAt: new Date().toISOString(),
  supervisorStatus: greenComplete ? 'green' : 'red',
  allComplete: greenComplete,
  matrixPath: paths.surfaceMatrix,
  matrixStatus: effectiveMatrixStatus,
  provenCoordinationScaleTier: highestPassingTier,
  qualificationMode: scaleQualification?.qualificationMode || 'real_mailchimp_repo_live_worker_farm',
  stopReason,
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
    blockerReport: fs.existsSync(paths.blockerReport) ? paths.blockerReport : null
  },
  blocker: blocker || null,
  campaignState
};

const completionSummary = {
  generatedAt: new Date().toISOString(),
  supervisorConfirmedCompletion: programState.supervisorStatus === 'green' && effectiveMatrixStatus === 'all_complete',
  supervisorStatus: programState.supervisorStatus,
  surfaceMatrixPath: paths.surfaceMatrix,
  surfaceMatrixStatus: effectiveMatrixStatus,
  targetPath: contract.targetPath,
  provenCoordinationScaleTier: highestPassingTier,
  qualificationMode: scaleQualification?.qualificationMode || 'real_mailchimp_repo_live_worker_farm',
  replyAnchor: contract.replyAnchor,
  blocker: blocker || null,
  stopReason,
  stages: programState.stages
};

const notificationState = {
  delivered: false,
  deliveredAt: null,
  awaitingNotifier: completionSummary.supervisorConfirmedCompletion,
  supervisorStatus: completionSummary.supervisorStatus,
  provenCoordinationScaleTier: highestPassingTier,
  qualificationMode: scaleQualification?.qualificationMode || 'real_mailchimp_repo_live_worker_farm',
  note: completionSummary.supervisorConfirmedCompletion
    ? 'ready for requester relay'
    : 'blocked or partial; requester relay should include blocker status'
};

fs.writeFileSync(paths.programState, JSON.stringify(programState, null, 2));
fs.writeFileSync(paths.completionSummary, JSON.stringify(completionSummary, null, 2));
fs.writeFileSync(paths.notificationState, JSON.stringify(notificationState, null, 2));
fs.writeFileSync(paths.supervisorStatus, JSON.stringify({
  generatedAt: new Date().toISOString(),
  truth,
  supervisorStatus: completionSummary.supervisorStatus,
  surfaceMatrixStatus: matrix.status,
  provenCoordinationScaleTier: highestPassingTier,
  qualificationMode: scaleQualification?.qualificationMode || 'real_mailchimp_repo_live_worker_farm',
  stages: programState.stages,
  blocker: blocker || null,
  stopReason
}, null, 2));

matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(paths.surfaceMatrix, matrix);
truth = deriveSupervisorTruth(matrix);

const finalSupervisorStatus = greenComplete && truth.supervisorStatus === 'green' ? 'green' : 'red';
const finalCampaignState = setSupervisor(paths.campaignState, {
  status: finalSupervisorStatus,
  blocker: blocker || null,
  matrixStatus: matrix.status,
  note: greenComplete
    ? 'real repo orchestrator qualification reached supervisor-green completion with honest tier reporting'
    : 'real repo orchestrator qualification stopped with blocker or partial truth state'
});

programState.supervisorStatus = finalSupervisorStatus;
programState.allComplete = finalSupervisorStatus === 'green' && matrix.status === 'all_complete';
programState.matrixStatus = effectiveMatrixStatus;
programState.campaignState = finalCampaignState;

completionSummary.supervisorConfirmedCompletion = programState.allComplete;
completionSummary.supervisorStatus = finalSupervisorStatus;
completionSummary.surfaceMatrixStatus = effectiveMatrixStatus;

notificationState.awaitingNotifier = completionSummary.supervisorConfirmedCompletion;
notificationState.supervisorStatus = finalSupervisorStatus;

fs.writeFileSync(paths.programState, JSON.stringify(programState, null, 2));
fs.writeFileSync(paths.completionSummary, JSON.stringify(completionSummary, null, 2));
fs.writeFileSync(paths.notificationState, JSON.stringify(notificationState, null, 2));
fs.writeFileSync(paths.supervisorStatus, JSON.stringify({
  generatedAt: new Date().toISOString(),
  truth,
  supervisorStatus: finalSupervisorStatus,
  surfaceMatrixStatus: matrix.status,
  provenCoordinationScaleTier: highestPassingTier,
  qualificationMode: scaleQualification?.qualificationMode || 'real_mailchimp_repo_live_worker_farm',
  stages: programState.stages,
  blocker: blocker || null,
  stopReason
}, null, 2));

console.log(JSON.stringify({
  supervisorStatus: finalSupervisorStatus,
  matrixStatus: matrix.status,
  provenCoordinationScaleTier: highestPassingTier,
  blocker: blocker || null
}, null, 2));
process.exit(finalSupervisorStatus === 'green' ? 0 : 1);
