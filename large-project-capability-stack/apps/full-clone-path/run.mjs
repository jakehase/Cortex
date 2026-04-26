import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compileTaskContract, saveContract } from '../../packages/task-contract/index.mjs';
import { createIssueGraph, upsertIssue, linkDependency, saveGraph, loadGraph, setIssueStatus } from '../../packages/issue-dag/index.mjs';
import { initializeCampaign, recoverCampaign, updateWorker, claimWorkerIteration, completeWorkerIteration } from '../../packages/campaign-runtime/index.mjs';
import { compileSurfaceMatrix, saveMatrix } from '../../packages/surface-matrix/index.mjs';
import { createLedger, appendLedgerEvent, writeCheckpoint, recoverFromLedger } from '../../packages/recovery-ledger/index.mjs';
import {
  createClaimThresholdModel,
  collectRepoPathEvidence,
  analyzeThresholdGaps,
  compileUpgradeRoadmap,
  estimateCostTrajectory
} from '../../packages/full-clone-path/index.mjs';
import { discoverTargetEvidenceArtifacts } from '../../packages/certification/index.mjs';
import { ROOT, TARGET, ARTIFACT_ROOT, VALIDATION_DIR, REPORTS_DIR, paths, truthPaths, surfaceDefinitions } from './plan.mjs';

const TARGET_CLAIM = 'real_world_indistinguishable';

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runNode(args, { cwd, logPath, allowFailure = false }) {
  try {
    const output = execFileSync('node', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
    fs.writeFileSync(logPath, output);
    return { ok: true, output };
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}${error.message || ''}`;
    fs.writeFileSync(logPath, output);
    if (!allowFailure) throw error;
    return { ok: false, output };
  }
}

fs.mkdirSync(VALIDATION_DIR, { recursive: true });
fs.mkdirSync(REPORTS_DIR, { recursive: true });
for (const logName of ['path_supervisor.log', 'path_watch.log', 'path_notify.log']) {
  const logPath = path.join(VALIDATION_DIR, logName);
  if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, 'pending\n');
}

const contract = saveContract(paths.contract, compileTaskContract({
  anchor: 'current capability stack truth-gating results showing mailchimp-clone is scoped_parity, with large_product_replica as an intermediate bar but the desired top tier being real_world_indistinguishable',
  replyAnchor: 'user wants the explicit machine-readable roadmap from scoped_parity to real_world_indistinguishable for /root/clawd/mailchimp-clone',
  targetPath: ROOT,
  requestedFidelity: 'production_slice',
  requestedScope: [
    'R1 Top-tier threshold model refinement',
    'R2 Gap analysis to real_world_indistinguishable',
    'R3 Roadmap/backlog compiler for the top tier',
    'R4 Trajectory estimator for the top tier',
    'R5 Qualification artifacts + report',
    'R6 Tests / executable checks / requalification'
  ],
  stopCondition: 'supervisor_green_or_blocker_report',
  blockerPolicy: 'require_real_blocker_report_when_supervisor_red',
  evidenceRequirements: [
    'refreshed truth qualification targeted at real_world_indistinguishable',
    'threshold model json',
    'gap analysis json',
    'roadmap backlog json',
    'trajectory estimate json',
    'supervisor-owned program state / completion summary / surface matrix',
    'tests log'
  ],
  implementationSurface: 'actual code + tests + docs + machine-readable artifacts',
  campaignMode: 'persistent'
}));

let graph = createIssueGraph({ title: 'mailchimp-real-world-indistinguishable-path', targetPath: ROOT });
const issues = [
  ['r1.threshold_model', 'R1 Top-tier threshold model refinement'],
  ['r2.gap_analysis', 'R2 Gap analysis to real_world_indistinguishable'],
  ['r3.roadmap_compiler', 'R3 Roadmap/backlog compiler for the top tier'],
  ['r4.trajectory_estimator', 'R4 Trajectory estimator for the top tier'],
  ['r5.reporting', 'R5 Qualification artifacts + report'],
  ['r6.tests_and_requalification', 'R6 Tests + executable requalification']
];
for (const [id, title] of issues) {
  graph = upsertIssue(graph, {
    id,
    title,
    lane: id.startsWith('r6') ? 'validation' : id.startsWith('r5') ? 'reporting' : 'compiler',
    owner: 'stack',
    acceptanceCriteria: ['machine-readable artifact written', 'evidence or executable proof present'],
    status: 'pending'
  });
}
for (let i = 1; i < issues.length; i += 1) graph = linkDependency(graph, issues[i][0], issues[i - 1][0]);
saveGraph(paths.graph, graph);

createLedger(paths.ledger, { contractPath: paths.contract, graphPath: paths.graph, matrixPath: paths.matrix });
appendLedgerEvent(paths.ledger, { type: 'contract-compiled', scope: contract.requestedScope });
writeCheckpoint(paths.ledger, 'bootstrapped', { issueCount: issues.length });

initializeCampaign(paths.campaign, {
  contractPath: paths.contract,
  graphPath: paths.graph,
  matrixPath: paths.matrix,
  ledgerPath: paths.ledger,
  mode: 'persistent',
  stopCondition: 'supervisor_green_or_blocker_report'
});
recoverCampaign(paths.campaign, { contractPath: paths.contract, graphPath: paths.graph, matrixPath: paths.matrix, ledgerPath: paths.ledger });
claimWorkerIteration(paths.campaign, { claimedBy: 'apps/full-clone-path/run.mjs', reason: 'mailchimp_real_world_indistinguishable_path_compilation' });
updateWorker(paths.campaign, { id: 'path.start', ok: true, note: 'mailchimp real-world indistinguishable path compilation started' });

const repoTests = runNode(['--test', 'tests/*.test.mjs'], {
  cwd: ROOT,
  logPath: path.join(VALIDATION_DIR, 'repo_tests.log')
});
updateWorker(paths.campaign, { id: 'path.repo-tests', ok: repoTests.ok });

const truthRefresh = runNode(['apps/qualification/run.mjs'], {
  cwd: ROOT,
  logPath: path.join(VALIDATION_DIR, 'truth_refresh.log')
});
updateWorker(paths.campaign, { id: 'path.truth-refresh', ok: truthRefresh.ok, note: 'mailchimp_full_clone_truth rerun complete at real_world_indistinguishable target' });

const truthCertification = loadJson(truthPaths.certification);
const truthParity = loadJson(truthPaths.parity);
const truthArchitecture = loadJson(truthPaths.architecture);
const truthSummary = loadJson(truthPaths.qualificationSummary);
const truthCompletion = loadJson(truthPaths.completionSummary);
const truthMatrix = loadJson(truthPaths.surfaceMatrix);
const targetEvidenceArtifacts = discoverTargetEvidenceArtifacts(TARGET);

const thresholdModel = createClaimThresholdModel();
writeJson(paths.thresholdModel, thresholdModel);

const repoEvidence = collectRepoPathEvidence({
  repoRoot: TARGET,
  architectureReport: truthArchitecture,
  certification: truthCertification,
  parityReport: truthParity,
  evidenceArtifacts: [
    truthPaths.certification,
    truthPaths.parity,
    truthPaths.architecture,
    truthPaths.qualificationSummary,
    truthPaths.completionSummary,
    truthPaths.surfaceMatrix,
    path.join(VALIDATION_DIR, 'repo_tests.log'),
    path.join(VALIDATION_DIR, 'truth_refresh.log'),
    ...targetEvidenceArtifacts
  ],
  repoTestsOk: repoTests.ok,
  targetTestsOk: truthSummary.targetTestsOk,
  supervisorOk: truthSummary.mailchimpSupervisorOk && truthSummary.mailchimpWatchOk,
  notifyOk: truthSummary.mailchimpNotifyOk
});
writeJson(paths.repoEvidence, repoEvidence);

const gapAnalysis = analyzeThresholdGaps({
  thresholdModel,
  evidence: repoEvidence,
  targetClaim: TARGET_CLAIM
});
writeJson(paths.gapAnalysis, gapAnalysis);

const roadmap = compileUpgradeRoadmap({
  gapReport: gapAnalysis,
  thresholdModel,
  targetClaim: TARGET_CLAIM
});
writeJson(paths.roadmap, roadmap);

const trajectory = estimateCostTrajectory({
  gapReport: gapAnalysis,
  roadmap,
  thresholdModel,
  targetClaim: TARGET_CLAIM
});
writeJson(paths.trajectory, trajectory);

const recovery = recoverFromLedger(paths.ledger);
writeCheckpoint(paths.ledger, 'analysis-complete', {
  highestAllowedClaim: truthCertification.highestAllowedClaim,
  blockerCount: gapAnalysis.summary.blockerReasons.length,
  recoveryRecovered: Boolean(recovery.latestCheckpoint)
});
appendLedgerEvent(paths.ledger, { type: 'path-analysis-complete', targetClaim: TARGET_CLAIM });

const reportText = `# Mailchimp Real-World Indistinguishability Path Report — 2026-04-02

Qualification target: ${TARGET}
Current certified claim: ${truthCertification.highestAllowedClaim}
Current requested claim in truth qualification: ${truthCertification.requestedClaim}
Target claim: ${TARGET_CLAIM}
Target currently eligible: ${gapAnalysis.summary.eligibleForTargetClaim}

## Current truth gate state
- Requested claim allowed: ${truthCertification.requestedClaimAllowed}
- Highest allowed claim: ${truthCertification.highestAllowedClaim}
- Truth qualification matrix status: ${truthMatrix.status}
- Truth completion summary supervisor confirmed: ${truthCompletion.supervisorConfirmedCompletion}
- Browser evidence driver: ${repoEvidence.qualitative.browserDriver}
- Real browser proven: ${repoEvidence.qualitative.realBrowser}
- Weighted minimum-threshold coverage: ${gapAnalysis.summary.weightedCoverage}

## Why the top-tier claim is still denied
- ${gapAnalysis.summary.blockerReasons.join('\n- ')}

## Quantified shortfalls to the ${TARGET_CLAIM} minimum
- Product files: ${repoEvidence.census.productFiles} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.productFiles}
- Product lines: ${repoEvidence.census.productLines} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.productLines}
- Test files: ${repoEvidence.census.testFiles} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.testFiles}
- Test lines: ${repoEvidence.census.testLines} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.testLines}
- Package count: ${repoEvidence.census.packageCount} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.packageCount}
- App count: ${repoEvidence.census.appCount} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.appCount}
- Module roots: ${repoEvidence.census.moduleRoots} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.moduleRoots}
- Route files: ${repoEvidence.census.routeFiles} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.routeFiles}
- Domain files: ${repoEvidence.census.domainFiles} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.domainFiles}
- Complete surface families: ${repoEvidence.census.surfaceFamiliesComplete} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.surfaceFamiliesComplete}
- Parity checks: ${repoEvidence.census.parityChecks} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.parityChecks}
- Live HTTP checks: ${repoEvidence.census.liveHttpChecks} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.liveHttpChecks}
- Browser checks: ${repoEvidence.census.browserChecks} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.browserChecks}
- Real browser checks: ${repoEvidence.census.realBrowserChecks} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.realBrowserChecks}
- Browser journey families: ${repoEvidence.census.browserJourneyFamilies} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.browserJourneyFamilies}
- Integration surface families: ${repoEvidence.census.integrationSurfaceFamilies} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.integrationSurfaceFamilies}
- Enterprise surface families: ${repoEvidence.census.enterpriseSurfaceFamilies} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.enterpriseSurfaceFamilies}
- Artifact classes: ${repoEvidence.census.artifactClasses} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.artifactClasses}
- Evidence artifacts: ${repoEvidence.census.evidenceArtifacts} / ${thresholdModel.claimLevels[TARGET_CLAIM].minimums.metrics.evidenceArtifacts}

## Structural gap clusters
${gapAnalysis.summary.strongestStructuralBlockers.map((blocker) => `- ${blocker.id}: ${blocker.unmetMetrics.join(', ')}`).join('\n')}

## Missing required surface families
${gapAnalysis.surfaceFamilies.missingRequired.length > 0 ? gapAnalysis.surfaceFamilies.missingRequired.map((family) => `- ${family}`).join('\n') : '- none'}

## Recommended roadmap lanes
${roadmap.lanes.map((lane) => `- ${lane.id}: ${lane.title} — ${lane.focus}`).join('\n')}

## Milestones
${roadmap.milestones.map((milestone) => `- ${milestone.id} [${milestone.lane}] -> ${milestone.title}`).join('\n')}

## Trajectory reading
- Estimated product lines still needed to clear the minimum: ${trajectory.estimates.estimatedProductLinesNeeded}
- Estimated test lines still needed to clear the minimum: ${trajectory.estimates.estimatedTestLinesNeeded}
- Estimated new packages: ${trajectory.estimates.estimatedNewPackages}
- Estimated new module roots: ${trajectory.estimates.estimatedNewModuleRoots}
- Estimated new apps: ${trajectory.estimates.estimatedNewApps}
- Estimated browser journey families still needed: ${trajectory.estimates.estimatedBrowserJourneyFamiliesToCover}
- Estimated integration families still needed: ${trajectory.estimates.estimatedIntegrationFamiliesToAdd}
- Estimated enterprise families still needed: ${trajectory.estimates.estimatedEnterpriseFamiliesToAdd}
- Estimated artifact classes still needed: ${trajectory.estimates.estimatedArtifactClassesToAdd}

## Bottom line
The current repo is honestly classifiable as ${truthCertification.highestAllowedClaim}. It is not currently eligible for ${TARGET_CLAIM}. To become mechanically classifiable as real_world_indistinguishable, the repo would need real browser automation at scale, materially broader ecosystem and enterprise surface depth, much larger architecture/package breadth, and a far denser evidence trail than it has today.
`;
fs.writeFileSync(paths.finalReport, reportText);
fs.mkdirSync(path.dirname(paths.finalReportDoc), { recursive: true });
fs.writeFileSync(paths.finalReportDoc, reportText);

const qualificationSummary = {
  generatedAt: new Date().toISOString(),
  truthRefreshOk: truthRefresh.ok,
  repoTestsOk: repoTests.ok,
  truthSummary,
  truthHighestAllowedClaim: truthCertification.highestAllowedClaim,
  targetClaim: TARGET_CLAIM,
  targetClaimCurrentlyEligible: gapAnalysis.summary.eligibleForTargetClaim,
  blockerReasons: gapAnalysis.summary.blockerReasons,
  roadmapMilestones: roadmap.milestones.length,
  roadmapLanes: roadmap.lanes.map((lane) => lane.id),
  currentPosture: gapAnalysis.summary.posture,
  weightedCoverage: gapAnalysis.summary.weightedCoverage,
  artifactRoot: ARTIFACT_ROOT
};
writeJson(paths.qualificationSummary, qualificationSummary);

const issueArtifacts = {
  'r1.threshold_model': [paths.thresholdModel, 'packages/full-clone-path/index.mjs', 'packages/full-clone-path/thresholds.mjs'],
  'r2.gap_analysis': [paths.repoEvidence, paths.gapAnalysis, 'packages/full-clone-path/gap-analysis.mjs'],
  'r3.roadmap_compiler': [paths.roadmap, 'packages/full-clone-path/roadmap.mjs'],
  'r4.trajectory_estimator': [paths.trajectory, 'packages/full-clone-path/trajectory.mjs'],
  'r5.reporting': [paths.finalReport, paths.finalReportDoc, paths.qualificationSummary],
  'r6.tests_and_requalification': [
    path.join(VALIDATION_DIR, 'repo_tests.log'),
    path.join(VALIDATION_DIR, 'truth_refresh.log'),
    truthPaths.certification,
    truthPaths.completionSummary
  ]
};

graph = loadGraph(paths.graph);
for (const [issueId, artifacts] of Object.entries(issueArtifacts)) {
  graph = setIssueStatus(graph, issueId, 'complete', artifacts);
}
saveGraph(paths.graph, graph);

const matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(paths.matrix, matrix);
updateWorker(paths.campaign, {
  id: 'path.artifacts-complete',
  ok: true,
  matrixStatus: matrix.status,
  currentClaim: truthCertification.highestAllowedClaim,
  targetClaim: TARGET_CLAIM
});
completeWorkerIteration(paths.campaign, {
  ok: true,
  note: 'mailchimp real-world indistinguishable path artifacts compiled',
  outcome: { matrixStatus: matrix.status, targetClaimEligible: gapAnalysis.summary.eligibleForTargetClaim }
});

const pathSupervisor = runNode(['apps/full-clone-path/supervisor.mjs'], {
  cwd: ROOT,
  logPath: path.join(VALIDATION_DIR, 'path_supervisor.log')
});
const pathWatch = runNode(['apps/full-clone-path/watch.mjs'], {
  cwd: ROOT,
  logPath: path.join(VALIDATION_DIR, 'path_watch.log')
});
const pathNotify = runNode(['apps/full-clone-path/notify-once.mjs'], {
  cwd: ROOT,
  logPath: path.join(VALIDATION_DIR, 'path_notify.log')
});

writeJson(paths.supervisorStatus, {
  generatedAt: new Date().toISOString(),
  pathSupervisorOk: pathSupervisor.ok,
  pathWatchOk: pathWatch.ok,
  pathNotifyOk: pathNotify.ok,
  matrixStatus: loadJson(paths.matrix).status,
  currentClaim: truthCertification.highestAllowedClaim,
  targetClaim: TARGET_CLAIM,
  eligibleForTargetClaim: gapAnalysis.summary.eligibleForTargetClaim
});

console.log(JSON.stringify({
  ok: true,
  artifactRoot: ARTIFACT_ROOT,
  currentClaim: truthCertification.highestAllowedClaim,
  targetClaim: TARGET_CLAIM,
  eligibleForTargetClaim: gapAnalysis.summary.eligibleForTargetClaim
}, null, 2));
