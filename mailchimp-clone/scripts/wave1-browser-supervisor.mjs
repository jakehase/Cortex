import fs from 'node:fs';
import path from 'node:path';
import { loadContract } from '../../large-project-capability-stack/packages/task-contract/index.mjs';
import { loadGraph, saveGraph, setIssueStatus, summarizeGraph } from '../../large-project-capability-stack/packages/issue-dag/index.mjs';
import { compileSurfaceMatrix, deriveSupervisorTruth, saveMatrix } from '../../large-project-capability-stack/packages/surface-matrix/index.mjs';
import { initializeCampaign, recoverCampaign, setSupervisor } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import {
  ARTIFACT_ROOT,
  CONTRACT_PATH,
  GRAPH_PATH,
  MATRIX_PATH,
  PROGRAM_STATE_PATH,
  SUMMARY_PATH,
  NOTIFY_PATH,
  WORKER_STATE_PATH,
  REPORT_PATH,
  PROOF_PATH,
  LEDGER_PATH,
  surfaceDefinitions
} from './lib/wave1-browser-foundation-plan.mjs';

fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
if (!fs.existsSync(PROGRAM_STATE_PATH)) {
  initializeCampaign(PROGRAM_STATE_PATH, {
    mode: 'persistent',
    stopCondition: 'supervisor_green_or_blocker_report',
    contractPath: CONTRACT_PATH,
    graphPath: GRAPH_PATH,
    matrixPath: MATRIX_PATH,
    ledgerPath: LEDGER_PATH
  });
}

const contract = loadContract(CONTRACT_PATH);
let graph = loadGraph(GRAPH_PATH);
const workerState = fs.existsSync(WORKER_STATE_PATH) ? JSON.parse(fs.readFileSync(WORKER_STATE_PATH, 'utf8')) : { ok: false, steps: [] };
const proof = fs.existsSync(PROOF_PATH) ? JSON.parse(fs.readFileSync(PROOF_PATH, 'utf8')) : { ok: false, realBrowser: false, browserChecks: 0, realBrowserChecks: 0, browserJourneyFamilies: 0, coveredFamilies: [] };
const reportPresent = fs.existsSync(REPORT_PATH);
const ledgerPresent = fs.existsSync(LEDGER_PATH);

if (workerState.ok) {
  graph = setIssueStatus(graph, 'browser_observability_shell', 'complete', ['packages/app/view.mjs', 'package.json']);
  graph = setIssueStatus(graph, 'real_browser_runtime', 'complete', ['package-lock.json', 'tests/browser-realism.test.mjs', 'scripts/lib/wave1-browser-proof.mjs']);
}
if (proof.ok && proof.realBrowser && proof.browserJourneyFamilies >= 6) {
  graph = setIssueStatus(graph, 'browser_journey_coverage', 'complete', ['artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/validation/browser_proof.json']);
}
if (proof.ok && reportPresent) {
  graph = setIssueStatus(graph, 'browser_evidence_artifacts', 'complete', [
    'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/validation/browser_proof.json',
    'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/reports/wave1_browser_foundation_report.json'
  ]);
}
if (workerState.ok && proof.ok && reportPresent && ledgerPresent) {
  graph = setIssueStatus(graph, 'wave1_supervision_and_runtime', 'complete', [
    'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/contract.json',
    'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/issue_graph.json',
    'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/worker_state.json',
    'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/recovery/ledger.json'
  ]);
}
saveGraph(GRAPH_PATH, graph);

let matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(MATRIX_PATH, matrix);
let truth = deriveSupervisorTruth(matrix);
const summaryGraph = summarizeGraph(graph);
const blocker = workerState.ok === false
  ? (workerState.blocker?.message || 'Wave 1 worker failed before browser proof completed.')
  : proof.ok === false
    ? (proof.blocker?.message || 'Real browser proof did not complete successfully.')
    : null;

setSupervisor(PROGRAM_STATE_PATH, {
  status: truth.supervisorStatus,
  blocker,
  matrixStatus: matrix.status,
  note: blocker ? 'Wave 1 browser supervisor found a real blocker.' : 'Wave 1 browser surface matrix evaluated successfully.'
});

function writeSummaryAndNotification(activeTruth, activeMatrix) {
  const completionSummary = {
    generatedAt: new Date().toISOString(),
    scope: 'Wave 1 browser realism foundation',
    supervisorConfirmedCompletion: activeTruth.supervisorStatus === 'green' && activeMatrix.status === 'all_complete',
    supervisorStatus: activeTruth.supervisorStatus,
    matrixStatus: activeMatrix.status,
    contractPath: path.relative(contract.targetPath, CONTRACT_PATH),
    graphPath: path.relative(contract.targetPath, GRAPH_PATH),
    surfaceMatrixPath: path.relative(contract.targetPath, MATRIX_PATH),
    reportPath: path.relative(contract.targetPath, REPORT_PATH),
    proofPath: path.relative(contract.targetPath, PROOF_PATH),
    workerStatePath: path.relative(contract.targetPath, WORKER_STATE_PATH),
    ledgerPath: path.relative(contract.targetPath, LEDGER_PATH),
    graphSummary: summaryGraph,
    workerSteps: workerState.steps,
    proofSummary: {
      realBrowser: proof.realBrowser,
      browserChecks: proof.browserChecks,
      realBrowserChecks: proof.realBrowserChecks,
      browserJourneyFamilies: proof.browserJourneyFamilies,
      coveredFamilies: proof.coveredFamilies
    },
    note: 'Wave 1 completion is limited to browser realism foundation and does not claim full project completion or real_world_indistinguishable.'
  };
  const notificationState = activeTruth.supervisorStatus === 'green'
    ? { delivered: false, deliveredAt: null, notifier: null, awaitingNotifier: true }
    : { delivered: false, deliveredAt: null, notifier: null, awaitingNotifier: false, blockedReason: blocker || 'Supervisor red but no blocker report; campaign should continue.' };
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(completionSummary, null, 2));
  fs.writeFileSync(NOTIFY_PATH, JSON.stringify(notificationState, null, 2));
}

function normalizeProgramStateForWave1(activeTruth) {
  const programState = JSON.parse(fs.readFileSync(PROGRAM_STATE_PATH, 'utf8'));
  programState.contractPath = CONTRACT_PATH;
  programState.graphPath = GRAPH_PATH;
  programState.matrixPath = MATRIX_PATH;
  programState.ledgerPath = LEDGER_PATH;
  if (activeTruth.supervisorStatus === 'green') {
    programState.worker.queuedIterations = [];
    programState.worker.shouldRequeue = false;
  }
  fs.writeFileSync(PROGRAM_STATE_PATH, JSON.stringify(programState, null, 2));
}

writeSummaryAndNotification(truth, matrix);
normalizeProgramStateForWave1(truth);
matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(MATRIX_PATH, matrix);
truth = deriveSupervisorTruth(matrix);
setSupervisor(PROGRAM_STATE_PATH, {
  status: truth.supervisorStatus,
  blocker,
  matrixStatus: matrix.status,
  note: blocker ? 'Wave 1 browser supervisor found a real blocker.' : 'Wave 1 browser surface matrix evaluated successfully.'
});
writeSummaryAndNotification(truth, matrix);
normalizeProgramStateForWave1(truth);

const campaignState = recoverCampaign(PROGRAM_STATE_PATH);
fs.writeFileSync(path.join(ARTIFACT_ROOT, 'supervisor_status.json'), JSON.stringify({
  truth,
  matrixStatus: matrix.status,
  graphSummary: summaryGraph,
  blocker,
  proofSummary: {
    realBrowser: proof.realBrowser,
    browserChecks: proof.browserChecks,
    realBrowserChecks: proof.realBrowserChecks,
    browserJourneyFamilies: proof.browserJourneyFamilies,
    coveredFamilies: proof.coveredFamilies
  }
}, null, 2));

console.log(JSON.stringify({
  supervisorStatus: truth.supervisorStatus,
  matrixStatus: matrix.status,
  blocker,
  stopReason: campaignState.stopReason || null,
  proofSummary: {
    realBrowser: proof.realBrowser,
    browserChecks: proof.browserChecks,
    browserJourneyFamilies: proof.browserJourneyFamilies
  }
}, null, 2));
process.exit(truth.supervisorStatus === 'green' ? 0 : 1);
