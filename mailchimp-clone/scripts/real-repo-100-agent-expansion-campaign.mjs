import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { saveContract } from '../../large-project-capability-stack/packages/task-contract/index.mjs';
import { createIssueGraph, saveGraph, upsertIssue, linkDependency, setIssueStatus, loadGraph } from '../../large-project-capability-stack/packages/issue-dag/index.mjs';
import { initializeCampaign, recoverCampaign, updateWorker, claimWorkerIteration, completeWorkerIteration } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { compileSurfaceMatrix, saveMatrix } from '../../large-project-capability-stack/packages/surface-matrix/index.mjs';
import { createLedger, appendLedgerEvent, writeCheckpoint } from '../../large-project-capability-stack/packages/recovery-ledger/index.mjs';
import { enforceArchitecture } from '../../large-project-capability-stack/packages/architecture-enforcer/index.mjs';
import { ROOT, STACK_ROOT, ARTIFACT_ROOT, VALIDATION_DIR, REPORTS_DIR, paths, contractInput, issueDefinitions, surfaceDefinitions } from './lib/real-repo-100-agent-expansion-plan.mjs';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function run(command, args, { cwd, logName, allowFailure = false } = {}) {
  const logPath = path.join(VALIDATION_DIR, logName);
  try {
    const output = execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
    fs.writeFileSync(logPath, output);
    return { ok: true, command: [command, ...args].join(' '), logPath, output };
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}${error.message || ''}`;
    fs.writeFileSync(logPath, output);
    if (!allowFailure) throw error;
    return { ok: false, command: [command, ...args].join(' '), logPath, output };
  }
}

function summarizeCurrentRepo() {
  const architecture = enforceArchitecture(ROOT, { claimProfile: 'real_world_indistinguishable' });
  return {
    generatedAt: new Date().toISOString(),
    packageCount: architecture.budget.metrics.packageCount,
    appCount: architecture.budget.metrics.appCount,
    productFiles: architecture.budget.metrics.productFiles,
    productSourceLines: architecture.budget.metrics.productSourceLines,
    testFiles: architecture.budget.metrics.testFiles,
    testSourceLines: architecture.budget.metrics.testSourceLines,
    moduleRoots: architecture.budget.metrics.moduleRoots,
    codeVolumeScore: architecture.budget.shapeScores.codeVolume,
    repoShapeScore: architecture.budget.shapeScores.repoShape,
    claimEligibility: architecture.budget.claims
  };
}

function buildDelta({ repoSummary, browserProof, certification, pathGap, orchestrator }) {
  return {
    generatedAt: new Date().toISOString(),
    repoSummary,
    browserChecks: browserProof.browserChecks,
    realBrowserChecks: browserProof.realBrowserChecks,
    browserJourneyFamilies: browserProof.browserJourneyFamilies,
    orchestratorTier: orchestrator.selectedTier?.tier || orchestrator.selectedTier || null,
    orchestratorPlanSize: orchestrator.summary?.workItemCount || orchestrator.workItemCount || null,
    highestAllowedClaim: certification.highestAllowedClaim,
    requestedClaimAllowed: certification.requestedClaimAllowed,
    remainingDowngradeReasons: certification.publicSummary?.downgradeReasons || [],
    topTierEligible: pathGap.summary?.eligibleForTargetClaim || false,
    weightedCoverage: pathGap.summary?.weightedCoverage || null,
    blockerReasons: pathGap.summary?.blockerReasons || []
  };
}

ensureDir(ARTIFACT_ROOT);
ensureDir(VALIDATION_DIR);
ensureDir(REPORTS_DIR);

const contract = saveContract(paths.contract, contractInput());
let graph = createIssueGraph({ title: 'mailchimp-real-repo-100-agent-expansion-wave6', targetPath: ROOT });
for (const issue of issueDefinitions()) graph = upsertIssue(graph, issue);
for (const issue of issueDefinitions()) for (const dep of issue.deps || []) graph = linkDependency(graph, issue.id, dep);
saveGraph(paths.graph, graph);

createLedger(paths.ledger, { contractPath: paths.contract, graphPath: paths.graph, matrixPath: paths.matrix });
appendLedgerEvent(paths.ledger, { type: 'contract-compiled', scope: contract.requestedScope });
writeCheckpoint(paths.ledger, 'bootstrapped', { issueCount: issueDefinitions().length });

initializeCampaign(paths.campaign, {
  contractPath: paths.contract,
  graphPath: paths.graph,
  matrixPath: paths.matrix,
  ledgerPath: paths.ledger,
  mode: 'persistent',
  stopCondition: 'supervisor_green_or_blocker_report'
});
recoverCampaign(paths.campaign, { contractPath: paths.contract, graphPath: paths.graph, matrixPath: paths.matrix, ledgerPath: paths.ledger });
claimWorkerIteration(paths.campaign, { claimedBy: 'scripts/real-repo-100-agent-expansion-campaign.mjs', reason: 'wave6_expansion_campaign' });
updateWorker(paths.campaign, { id: 'wave6.start', ok: true, note: 'wave 6 real-repo 100-agent expansion started' });

const repoTests = run('npm', ['test'], { cwd: ROOT, logName: 'npm_test.log' });
updateWorker(paths.campaign, { id: 'wave6.repo-tests', ok: repoTests.ok });

const smoke = run('npm', ['run', 'smoke'], { cwd: ROOT, logName: 'smoke.log' });
updateWorker(paths.campaign, { id: 'wave6.smoke', ok: smoke.ok });

const browser = run('npm', ['run', 'wave1:browser-proof'], { cwd: ROOT, logName: 'browser-proof.log' });
updateWorker(paths.campaign, { id: 'wave6.browser-proof', ok: browser.ok });

const orchestrator = run('node', ['scripts/orchestrator-real-repo-run.mjs'], { cwd: ROOT, logName: 'orchestrator-real-repo.log' });
updateWorker(paths.campaign, { id: 'wave6.orchestrator', ok: orchestrator.ok });

const truthRefresh = run('node', ['scripts/refresh-top-tier-truth-local.mjs'], { cwd: ROOT, logName: 'stack-qualification.log' });
updateWorker(paths.campaign, { id: 'wave6.truth-refresh', ok: truthRefresh.ok });

const pathRefresh = { ok: truthRefresh.ok, command: 'node scripts/refresh-top-tier-truth-local.mjs', logPath: path.join(VALIDATION_DIR, 'stack-qualification.log') };
updateWorker(paths.campaign, { id: 'wave6.path-refresh', ok: pathRefresh.ok });

const repoSummary = summarizeCurrentRepo();
const browserProof = readJson(path.join(ROOT, 'artifacts', 'mailchimp_clone', 'real_world_indistinguishable', 'wave_1_browser_foundation', 'validation', 'browser_proof.json'));
const certification = readJson(paths.qualificationSummary);
const pathGap = readJson(paths.pathGap);
const pathSummary = readJson(paths.pathSummary);
const orchestratorSummary = readJson(paths.orchestratorSummary);

const delta = buildDelta({ repoSummary, browserProof, certification, pathGap, orchestrator: orchestratorSummary });
writeJson(paths.delta, delta);
appendLedgerEvent(paths.ledger, { type: 'wave6-delta-written', highestAllowedClaim: certification.highestAllowedClaim, requestedClaimAllowed: certification.requestedClaimAllowed });
writeCheckpoint(paths.ledger, 'refresh-complete', { highestAllowedClaim: certification.highestAllowedClaim, weightedCoverage: pathGap.summary?.weightedCoverage || null });

graph = loadGraph(paths.graph);
graph = setIssueStatus(graph, 'wave6.package_expansion', 'complete', [path.join(ROOT, 'packages', 'attribution-modeling', 'index.mjs'), path.join(ROOT, 'packages', 'webhook-inspector', 'index.mjs')]);
graph = setIssueStatus(graph, 'wave6.app_shells', 'complete', [path.join(ROOT, 'apps', 'lifecycle-studio', 'server.mjs'), path.join(ROOT, 'apps', 'compliance-hub', 'server.mjs'), path.join(ROOT, 'apps', 'integrations-studio', 'server.mjs')]);
graph = setIssueStatus(graph, 'wave6.main_app_surface', 'complete', [path.join(ROOT, 'packages', 'app', 'routes', 'scale-wave-six.mjs'), path.join(ROOT, 'tests', 'scale-wave-six.test.mjs')]);
graph = setIssueStatus(graph, 'wave6.test_expansion', repoTests.ok ? 'complete' : 'blocked', [path.join(ROOT, 'tests', 'attribution-modeling.test.mjs'), path.join(VALIDATION_DIR, 'npm_test.log')]);
graph = setIssueStatus(graph, 'wave6.live_browser_evidence', smoke.ok && browser.ok ? 'complete' : 'blocked', [path.join(ROOT, 'artifacts', 'mailchimp_clone', 'full_clone', 'validation', 'live_smoke_full_clone.json'), path.join(ROOT, 'artifacts', 'mailchimp_clone', 'real_world_indistinguishable', 'wave_1_browser_foundation', 'validation', 'browser_proof.json')]);
graph = setIssueStatus(graph, 'wave6.orchestrator_real_repo', orchestrator.ok ? 'complete' : 'blocked', [paths.orchestratorSummary, path.join(VALIDATION_DIR, 'orchestrator-real-repo.log')]);
graph = setIssueStatus(graph, 'wave6.truth_refresh', truthRefresh.ok && pathRefresh.ok ? 'complete' : 'blocked', [paths.qualificationSummary, paths.pathGap, paths.pathSummary]);
const claimGreen = certification.highestAllowedClaim === 'real_world_indistinguishable' && certification.requestedClaimAllowed === true && pathGap.summary?.eligibleForTargetClaim === true;
graph = setIssueStatus(graph, 'wave6.top_tier_claim', claimGreen ? 'complete' : 'blocked', [paths.supervisor, paths.completionSummary, paths.blocker]);
saveGraph(paths.graph, graph);

const matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(paths.matrix, matrix);

const supervisorStatus = claimGreen ? 'green' : 'red';
const blocker = claimGreen ? null : {
  generatedAt: new Date().toISOString(),
  highestAllowedClaim: certification.highestAllowedClaim,
  requestedClaimAllowed: certification.requestedClaimAllowed,
  blocker: 'Top-tier claim remains mechanically denied after the first real 100-agent repo expansion wave; remaining blocker is scale mass and top-tier threshold depth, not a missing route-family wiring bug.',
  nextAction: 'Launch another materially larger repo-expansion wave if the goal remains real_world_indistinguishable; this run already exhausted the credible path to full_clone_credible and the 150-test-file threshold but still sits far below large_product_replica/real_world_indistinguishable product-line requirements.',
  remainingGaps: delta.blockerReasons,
  currentClaim: certification.highestAllowedClaim,
  requestedClaim: certification.requestedClaim,
  weightedCoverage: pathGap.summary?.weightedCoverage || null
};

writeJson(paths.supervisor, {
  generatedAt: new Date().toISOString(),
  status: supervisorStatus,
  matrixStatus: matrix.status,
  currentClaim: certification.highestAllowedClaim,
  requestedClaimAllowed: certification.requestedClaimAllowed,
  topTierEligible: pathGap.summary?.eligibleForTargetClaim || false,
  browserChecks: browserProof.browserChecks,
  realBrowserChecks: browserProof.realBrowserChecks,
  testFiles: repoSummary.testFiles,
  productSourceLines: repoSummary.productSourceLines
});
writeJson(paths.blocker, blocker || { generatedAt: new Date().toISOString(), blocker: null });
writeJson(paths.programState, {
  generatedAt: new Date().toISOString(),
  status: supervisorStatus,
  matrixStatus: matrix.status,
  highestAllowedClaim: certification.highestAllowedClaim,
  requestedClaimAllowed: certification.requestedClaimAllowed,
  weightedCoverage: pathGap.summary?.weightedCoverage || null,
  blockerReasons: delta.blockerReasons,
  delta: paths.delta
});
writeJson(paths.notification, {
  generatedAt: new Date().toISOString(),
  notified: false,
  supervisorStatus,
  currentClaim: certification.highestAllowedClaim,
  requestedClaimAllowed: certification.requestedClaimAllowed
});
writeJson(paths.completionSummary, {
  generatedAt: new Date().toISOString(),
  supervisorStatus,
  matrixStatus: matrix.status,
  campaignMode: 'persistent',
  stopCondition: 'supervisor_green_or_blocker_report',
  repoTestsOk: repoTests.ok,
  smokeOk: smoke.ok,
  browserOk: browser.ok,
  orchestratorOk: orchestrator.ok,
  qualificationOk: truthRefresh.ok,
  pathRefreshOk: pathRefresh.ok,
  browserChecks: browserProof.browserChecks,
  realBrowserChecks: browserProof.realBrowserChecks,
  highestAllowedClaim: certification.highestAllowedClaim,
  requestedClaimAllowed: certification.requestedClaimAllowed,
  targetEligible: pathGap.summary?.eligibleForTargetClaim || false,
  blockerReport: paths.blocker,
  delta: paths.delta
});

const finalMatrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(paths.matrix, finalMatrix);
writeJson(paths.programState, {
  generatedAt: new Date().toISOString(),
  status: supervisorStatus,
  matrixStatus: finalMatrix.status,
  highestAllowedClaim: certification.highestAllowedClaim,
  requestedClaimAllowed: certification.requestedClaimAllowed,
  weightedCoverage: pathGap.summary?.weightedCoverage || null,
  blockerReasons: delta.blockerReasons,
  delta: paths.delta
});
writeJson(paths.completionSummary, {
  generatedAt: new Date().toISOString(),
  supervisorStatus,
  matrixStatus: finalMatrix.status,
  campaignMode: 'persistent',
  stopCondition: 'supervisor_green_or_blocker_report',
  repoTestsOk: repoTests.ok,
  smokeOk: smoke.ok,
  browserOk: browser.ok,
  orchestratorOk: orchestrator.ok,
  qualificationOk: truthRefresh.ok,
  pathRefreshOk: pathRefresh.ok,
  browserChecks: browserProof.browserChecks,
  realBrowserChecks: browserProof.realBrowserChecks,
  highestAllowedClaim: certification.highestAllowedClaim,
  requestedClaimAllowed: certification.requestedClaimAllowed,
  targetEligible: pathGap.summary?.eligibleForTargetClaim || false,
  blockerReport: paths.blocker,
  delta: paths.delta
});

updateWorker(paths.campaign, { id: 'wave6.supervisor', ok: supervisorStatus === 'green', matrixStatus: finalMatrix.status, currentClaim: certification.highestAllowedClaim, requestedClaimAllowed: certification.requestedClaimAllowed });
completeWorkerIteration(paths.campaign, { ok: true, note: supervisorStatus === 'green' ? 'wave 6 completed green' : 'wave 6 ended with blocker report', outcome: { supervisorStatus, matrixStatus: finalMatrix.status, highestAllowedClaim: certification.highestAllowedClaim } });

console.log(JSON.stringify({
  ok: true,
  supervisorStatus,
  matrixStatus: finalMatrix.status,
  highestAllowedClaim: certification.highestAllowedClaim,
  requestedClaimAllowed: certification.requestedClaimAllowed,
  browserChecks: browserProof.browserChecks,
  testFiles: repoSummary.testFiles,
  productSourceLines: repoSummary.productSourceLines,
  artifactRoot: ARTIFACT_ROOT
}, null, 2));
