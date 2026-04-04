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
  SMOKE_PATH,
  EVIDENCE_PATH,
  LEDGER_PATH,
  surfaceDefinitions
} from './lib/wave2-integration-enterprise-plan.mjs';

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
const smoke = fs.existsSync(SMOKE_PATH) ? JSON.parse(fs.readFileSync(SMOKE_PATH, 'utf8')) : { ok: false, checklist: [] };
const evidence = fs.existsSync(EVIDENCE_PATH) ? JSON.parse(fs.readFileSync(EVIDENCE_PATH, 'utf8')) : { ok: false };
const reportPresent = fs.existsSync(REPORT_PATH);
const ledgerPresent = fs.existsSync(LEDGER_PATH);

if (workerState.ok && smoke.ok && evidence.ok && reportPresent && ledgerPresent) {
  graph = setIssueStatus(graph, 'wave2_supervision_and_runtime', 'complete', [
    'artifacts/mailchimp_clone/real_world_indistinguishable/wave_2_integration_enterprise/contract.json',
    'artifacts/mailchimp_clone/real_world_indistinguishable/wave_2_integration_enterprise/issue_graph.json',
    'artifacts/mailchimp_clone/real_world_indistinguishable/wave_2_integration_enterprise/worker_state.json',
    'artifacts/mailchimp_clone/real_world_indistinguishable/wave_2_integration_enterprise/recovery/ledger.json',
    'artifacts/mailchimp_clone/real_world_indistinguishable/wave_2_integration_enterprise/reports/wave2_integration_enterprise_report.json',
    'artifacts/mailchimp_clone/real_world_indistinguishable/wave_2_integration_enterprise/validation/live_smoke.json',
    'artifacts/mailchimp_clone/real_world_indistinguishable/wave_2_integration_enterprise/validation/wave2_surface_evidence.json'
  ]);
}
saveGraph(GRAPH_PATH, graph);

let matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(MATRIX_PATH, matrix);
let truth = deriveSupervisorTruth(matrix);
const summaryGraph = summarizeGraph(graph);
const blocker = workerState.ok === false
  ? (workerState.blocker?.message || 'Wave 2 worker failed before validation completed.')
  : smoke.ok === false
    ? 'Wave 2 live smoke did not complete successfully.'
    : evidence.ok === false
      ? 'Wave 2 evidence artifact is missing or invalid.'
      : null;

setSupervisor(PROGRAM_STATE_PATH, {
  status: truth.supervisorStatus,
  blocker,
  matrixStatus: matrix.status,
  note: blocker ? 'Wave 2 supervisor found a real blocker.' : 'Wave 2 surface matrix evaluated successfully.'
});

function writeSummaryAndNotification(activeTruth, activeMatrix) {
  const completionSummary = {
    generatedAt: new Date().toISOString(),
    scope: 'Wave 2 integration realism + enterprise/admin/compliance breadth',
    supervisorConfirmedCompletion: activeTruth.supervisorStatus === 'green' && activeMatrix.status === 'all_complete',
    supervisorStatus: activeTruth.supervisorStatus,
    matrixStatus: activeMatrix.status,
    contractPath: path.relative(contract.targetPath, CONTRACT_PATH),
    graphPath: path.relative(contract.targetPath, GRAPH_PATH),
    surfaceMatrixPath: path.relative(contract.targetPath, MATRIX_PATH),
    reportPath: path.relative(contract.targetPath, REPORT_PATH),
    smokePath: path.relative(contract.targetPath, SMOKE_PATH),
    evidencePath: path.relative(contract.targetPath, EVIDENCE_PATH),
    workerStatePath: path.relative(contract.targetPath, WORKER_STATE_PATH),
    ledgerPath: path.relative(contract.targetPath, LEDGER_PATH),
    graphSummary: summaryGraph,
    workerSteps: workerState.steps,
    smokeSummary: {
      liveHttpChecks: smoke.liveHttpChecks,
      surfaceFamiliesCovered: smoke.surfaceFamiliesCovered,
      passedChecks: smoke.checklist?.filter((entry) => entry.ok).length || 0
    },
    note: 'Wave 2 completion is limited to integration realism and enterprise/admin/compliance breadth. This does not claim full project completion or real_world_indistinguishable.'
  };
  const notificationState = activeTruth.supervisorStatus === 'green'
    ? { delivered: false, deliveredAt: null, notifier: null, awaitingNotifier: true }
    : { delivered: false, deliveredAt: null, notifier: null, awaitingNotifier: false, blockedReason: blocker || 'Supervisor red but no blocker report; campaign should continue.' };
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(completionSummary, null, 2));
  fs.writeFileSync(NOTIFY_PATH, JSON.stringify(notificationState, null, 2));
}

function normalizeProgramState(activeTruth) {
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
normalizeProgramState(truth);
matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(MATRIX_PATH, matrix);
truth = deriveSupervisorTruth(matrix);
setSupervisor(PROGRAM_STATE_PATH, {
  status: truth.supervisorStatus,
  blocker,
  matrixStatus: matrix.status,
  note: blocker ? 'Wave 2 supervisor found a real blocker.' : 'Wave 2 surface matrix evaluated successfully.'
});
writeSummaryAndNotification(truth, matrix);
normalizeProgramState(truth);

const campaignState = recoverCampaign(PROGRAM_STATE_PATH);
fs.writeFileSync(path.join(ARTIFACT_ROOT, 'supervisor_status.json'), JSON.stringify({
  truth,
  matrixStatus: matrix.status,
  graphSummary: summaryGraph,
  blocker,
  smokeSummary: {
    liveHttpChecks: smoke.liveHttpChecks,
    surfaceFamiliesCovered: smoke.surfaceFamiliesCovered,
    passedChecks: smoke.checklist?.filter((entry) => entry.ok).length || 0
  }
}, null, 2));

console.log(JSON.stringify({
  supervisorStatus: truth.supervisorStatus,
  matrixStatus: matrix.status,
  blocker,
  stopReason: campaignState.stopReason || null,
  smokeSummary: {
    liveHttpChecks: smoke.liveHttpChecks,
    surfaceFamiliesCovered: smoke.surfaceFamiliesCovered
  }
}, null, 2));
process.exit(truth.supervisorStatus === 'green' ? 0 : 1);
