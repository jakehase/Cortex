import fs from 'node:fs';
import path from 'node:path';
import { loadContract } from '../../large-project-capability-stack/packages/task-contract/index.mjs';
import { loadGraph, saveGraph, setIssueStatus, summarizeGraph } from '../../large-project-capability-stack/packages/issue-dag/index.mjs';
import { compileSurfaceMatrix, deriveSupervisorTruth, saveMatrix } from '../../large-project-capability-stack/packages/surface-matrix/index.mjs';
import { initializeCampaign, recoverCampaign, setSupervisor } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { CONTRACT_PATH, GRAPH_PATH, MATRIX_PATH, PROGRAM_STATE_PATH, SUMMARY_PATH, NOTIFY_PATH, WORKER_STATE_PATH, REPORT_PATH, surfaceDefinitions, ARTIFACT_ROOT, REPORTS_DIR, SMOKE_PATH, QUALIFICATION_PATH } from './lib/full-clone-plan.mjs';

fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
fs.mkdirSync(REPORTS_DIR, { recursive: true });

if (!fs.existsSync(PROGRAM_STATE_PATH)) initializeCampaign(PROGRAM_STATE_PATH, { mode: 'persistent', stopCondition: 'supervisor_green_or_blocker_report', contractPath: CONTRACT_PATH, graphPath: GRAPH_PATH, matrixPath: MATRIX_PATH });
const contract = loadContract(CONTRACT_PATH);
let graph = loadGraph(GRAPH_PATH);
const workerState = fs.existsSync(WORKER_STATE_PATH) ? JSON.parse(fs.readFileSync(WORKER_STATE_PATH, 'utf8')) : { ok: false, steps: [] };
const smoke = fs.existsSync(SMOKE_PATH) ? JSON.parse(fs.readFileSync(SMOKE_PATH, 'utf8')) : { ok: false, checklist: [] };
const reportPresent = fs.existsSync(REPORT_PATH);
const qualification = fs.existsSync(QUALIFICATION_PATH) ? JSON.parse(fs.readFileSync(QUALIFICATION_PATH, 'utf8')) : { ok: false };

if (workerState.ok && smoke.ok && reportPresent && qualification.ok) {
  graph = setIssueStatus(graph, 'supervision_and_completion_artifacts', 'complete', ['contract.json', 'issue_graph.json', 'surface_matrix.json', 'program_state.json', 'completion_summary.json', 'notification_state.json']);
  saveGraph(GRAPH_PATH, graph);
}

let matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(MATRIX_PATH, matrix);
let truth = deriveSupervisorTruth(matrix);
const summaryGraph = summarizeGraph(graph);
const blocker = truth.supervisorStatus === 'red' && workerState.ok === false ? 'Worker validation failed; inspect validation logs.' : null;
setSupervisor(PROGRAM_STATE_PATH, { status: truth.supervisorStatus, blocker, matrixStatus: matrix.status, note: blocker ? 'Validation failed before all requested surfaces were complete.' : 'Surface matrix evaluated successfully.' });

function writeSummaryAndNotification(activeTruth, activeMatrix) {
  const completionSummary = {
    generatedAt: new Date().toISOString(),
    supervisorConfirmedCompletion: activeTruth.supervisorStatus === 'green' && activeMatrix.status === 'all_complete',
    supervisorStatus: activeTruth.supervisorStatus,
    matrixStatus: activeMatrix.status,
    contractPath: path.relative(contract.targetPath, CONTRACT_PATH),
    graphPath: path.relative(contract.targetPath, GRAPH_PATH),
    surfaceMatrixPath: path.relative(contract.targetPath, MATRIX_PATH),
    reportPath: path.relative(contract.targetPath, REPORT_PATH),
    smokePath: path.relative(contract.targetPath, SMOKE_PATH),
    qualificationPath: path.relative(contract.targetPath, QUALIFICATION_PATH),
    graphSummary: summaryGraph,
    workerSteps: workerState.steps
  };
  const notificationState = activeTruth.supervisorStatus === 'green'
    ? { delivered: false, deliveredAt: null, notifier: null, awaitingNotifier: true }
    : { delivered: false, deliveredAt: null, notifier: null, awaitingNotifier: false, blockedReason: blocker || 'Supervisor red but no blocker report; campaign should continue.' };
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(completionSummary, null, 2));
  fs.writeFileSync(NOTIFY_PATH, JSON.stringify(notificationState, null, 2));
}

writeSummaryAndNotification(truth, matrix);
matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(MATRIX_PATH, matrix);
truth = deriveSupervisorTruth(matrix);
setSupervisor(PROGRAM_STATE_PATH, { status: truth.supervisorStatus, blocker, matrixStatus: matrix.status, note: blocker ? 'Validation failed before all requested surfaces were complete.' : 'Surface matrix evaluated successfully.' });
writeSummaryAndNotification(truth, matrix);

const campaignState = recoverCampaign(PROGRAM_STATE_PATH);
fs.writeFileSync(path.join(REPORTS_DIR, 'supervisor_status.json'), JSON.stringify({ truth, matrixStatus: matrix.status, graphSummary: summaryGraph, blocker }, null, 2));
console.log(JSON.stringify({ supervisorStatus: truth.supervisorStatus, matrixStatus: matrix.status, blocker, stopReason: campaignState.stopReason || null }, null, 2));
process.exit(truth.supervisorStatus === 'green' ? 0 : 1);
