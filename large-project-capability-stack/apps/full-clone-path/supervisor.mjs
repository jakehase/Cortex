import fs from 'node:fs';
import { loadContract } from '../../packages/task-contract/index.mjs';
import { loadGraph, summarizeGraph } from '../../packages/issue-dag/index.mjs';
import { compileSurfaceMatrix, deriveSupervisorTruth, saveMatrix } from '../../packages/surface-matrix/index.mjs';
import { recoverCampaign, setSupervisor } from '../../packages/campaign-runtime/index.mjs';
import { ARTIFACT_ROOT, REPORTS_DIR, paths, truthPaths, surfaceDefinitions } from './plan.mjs';

const TARGET_CLAIM = 'real_world_indistinguishable';

function loadJson(filePath, fallback = null) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback;
}

const contract = loadContract(paths.contract);
const graph = loadGraph(paths.graph);
const matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(paths.matrix, matrix);
const truth = deriveSupervisorTruth(matrix);
const graphSummary = summarizeGraph(graph);
const thresholdModel = loadJson(paths.thresholdModel, null);
const repoEvidence = loadJson(paths.repoEvidence, null);
const gapAnalysis = loadJson(paths.gapAnalysis, null);
const roadmap = loadJson(paths.roadmap, null);
const trajectory = loadJson(paths.trajectory, null);
const qualificationSummary = loadJson(paths.qualificationSummary, null);
const truthCertification = loadJson(truthPaths.certification, null);
const truthCompletion = loadJson(truthPaths.completionSummary, null);

const stageFlags = {
  threshold_model_present: Boolean(thresholdModel?.claimLevels?.real_world_indistinguishable),
  repo_evidence_snapshot_present: Boolean(repoEvidence?.census?.productFiles >= 0 && repoEvidence?.structuralCoverage?.enterprise),
  gap_analysis_present: Boolean(gapAnalysis?.summary?.posture && Array.isArray(gapAnalysis?.structuralGaps?.areas)),
  roadmap_present: Boolean(Array.isArray(roadmap?.milestones) && roadmap.milestones.length >= 7 && Array.isArray(roadmap?.lanes) && roadmap.lanes.some((lane) => lane.id === 'browser_realism')),
  trajectory_present: Boolean(Array.isArray(trajectory?.waves) && trajectory.waves.length >= 5),
  report_present: fs.existsSync(paths.finalReport),
  refreshed_truth_available: Boolean(
    truthCertification?.requestedClaim === TARGET_CLAIM
    && truthCertification?.highestAllowedClaim
    && truthCompletion?.supervisorConfirmedCompletion === true
  ),
  qualification_summary_present: Boolean(
    qualificationSummary?.artifactRoot === ARTIFACT_ROOT
    && qualificationSummary?.targetClaim === TARGET_CLAIM
    && typeof qualificationSummary?.targetClaimCurrentlyEligible === 'boolean'
  )
};

const stages = Object.entries(stageFlags).map(([id, complete]) => ({ id, complete }));
const allComplete = truth.supervisorStatus === 'green' && stages.every((stage) => stage.complete);
recoverCampaign(paths.campaign, { contractPath: paths.contract, graphPath: paths.graph, matrixPath: paths.matrix, ledgerPath: paths.ledger });
const campaignState = setSupervisor(paths.campaign, {
  status: allComplete ? 'green' : 'red',
  blocker: null,
  matrixStatus: matrix.status,
  note: 'real-world-indistinguishable path supervisor derived truth from R1-R6 surface matrix and top-tier path artifacts'
});

const programState = {
  generatedAt: new Date().toISOString(),
  supervisorStatus: allComplete ? 'green' : 'red',
  allComplete,
  matrixPath: paths.matrix,
  matrixStatus: matrix.status,
  graphSummary,
  stages,
  truthReference: {
    currentClaim: truthCertification?.highestAllowedClaim || null,
    targetClaim: TARGET_CLAIM,
    targetCurrentlyEligible: gapAnalysis?.summary?.eligibleForTargetClaim || false,
    blockerReasons: gapAnalysis?.summary?.blockerReasons || []
  },
  evidence: {
    thresholdModel: paths.thresholdModel,
    repoEvidence: paths.repoEvidence,
    gapAnalysis: paths.gapAnalysis,
    roadmap: paths.roadmap,
    trajectory: paths.trajectory,
    finalReport: paths.finalReport,
    qualificationSummary: paths.qualificationSummary
  },
  campaignState
};
const completionSummary = {
  generatedAt: new Date().toISOString(),
  supervisorConfirmedCompletion: allComplete,
  supervisorStatus: programState.supervisorStatus,
  surfaceMatrixPath: paths.matrix,
  surfaceMatrixStatus: matrix.status,
  targetPath: contract.targetPath,
  currentClaim: truthCertification?.highestAllowedClaim || null,
  targetClaim: TARGET_CLAIM,
  targetCurrentlyEligible: gapAnalysis?.summary?.eligibleForTargetClaim || false,
  stages
};
const notificationState = loadJson(paths.notification, {
  delivered: false,
  deliveredAt: null,
  awaitingNotifier: allComplete,
  supervisorStatus: programState.supervisorStatus,
  currentClaim: truthCertification?.highestAllowedClaim || null,
  targetClaim: TARGET_CLAIM
});

fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
fs.mkdirSync(REPORTS_DIR, { recursive: true });
fs.writeFileSync(paths.programState, JSON.stringify(programState, null, 2));
fs.writeFileSync(paths.completionSummary, JSON.stringify(completionSummary, null, 2));
fs.writeFileSync(paths.notification, JSON.stringify(notificationState, null, 2));
fs.writeFileSync(paths.supervisorStatus, JSON.stringify({ truth, stages, currentClaim: truthCertification?.highestAllowedClaim || null }, null, 2));

console.log(JSON.stringify({ supervisorStatus: programState.supervisorStatus, matrixStatus: matrix.status, allComplete }, null, 2));
process.exit(allComplete ? 0 : 1);
