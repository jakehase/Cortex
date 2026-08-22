import fs from 'node:fs';
import { loadContract } from '../../packages/task-contract/index.mjs';
import { loadGraph, summarizeGraph } from '../../packages/issue-dag/index.mjs';
import { compileSurfaceMatrix, deriveSupervisorTruth, saveMatrix } from '../../packages/surface-matrix/index.mjs';
import { recoverCampaign, setSupervisor } from '../../packages/campaign-runtime/index.mjs';
import { ARTIFACT_ROOT, REPORTS_DIR, paths, surfaceDefinitions } from './plan.mjs';

const REQUESTED_CLAIM = 'real_world_indistinguishable';

function loadJson(filePath, fallback = null) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback;
}

const contract = loadContract(paths.contract);
const graph = loadGraph(paths.graph);
const matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(paths.matrix, matrix);
const truth = deriveSupervisorTruth(matrix);
const graphSummary = summarizeGraph(graph);
const stackArchitecture = loadJson(paths.stackArchitecture, { ok: false });
const targetArchitecture = loadJson(paths.targetArchitecture, { ok: false });
const parity = loadJson(paths.parity, { ok: false });
const certification = loadJson(paths.certification, null);
const recovery = loadJson(paths.recovery, { ok: false });

const stageFlags = {
  contract_compiled: Boolean(contract.anchor && contract.targetPath),
  issue_graph_persisted: graph.issues.length >= 6,
  stack_architecture_checked: stackArchitecture?.ok === true,
  target_architecture_profiled: Boolean(targetArchitecture?.budget?.claims?.real_world_indistinguishable),
  browser_parity_evidence_present: parity?.ok === true && Boolean(parity?.browserAdapter?.evidence?.browser),
  truth_gate_enforced: Boolean(
    certification?.statusFlags
    && typeof certification.statusFlags.scoped_completion_green === 'boolean'
    && typeof certification.statusFlags.parity_for_scope_plausible === 'boolean'
    && typeof certification.statusFlags.full_clone_credible === 'boolean'
    && typeof certification.statusFlags.large_product_replica === 'boolean'
    && typeof certification.statusFlags.real_world_indistinguishable_not_proven === 'boolean'
  ),
  honest_claim_ladder: Boolean(
    certification
    && certification.requestedClaim === REQUESTED_CLAIM
    && certification.highestAllowedClaim
    && certification.claims?.real_world_indistinguishable
    && Array.isArray(certification.claims.real_world_indistinguishable.reasons)
  ),
  recovery_verified: recovery?.ok === true,
  final_report_present: fs.existsSync(paths.finalReport)
};

const stages = Object.entries(stageFlags).map(([id, complete]) => ({ id, complete }));
const allComplete = truth.supervisorStatus === 'green' && stages.every((stage) => stage.complete);
recoverCampaign(paths.campaign, { contractPath: paths.contract, graphPath: paths.graph, matrixPath: paths.matrix, ledgerPath: paths.ledger });
const campaignState = setSupervisor(paths.campaign, {
  status: allComplete ? 'green' : 'red',
  blocker: null,
  matrixStatus: matrix.status,
  note: 'qualification supervisor derived truth from Y1-Y6 surface matrix and certification gates'
});

const programState = {
  generatedAt: new Date().toISOString(),
  supervisorStatus: allComplete ? 'green' : 'red',
  allComplete,
  matrixPath: paths.matrix,
  matrixStatus: matrix.status,
  graphSummary,
  stages,
  certificationSummary: certification
    ? {
        requestedClaim: certification.requestedClaim,
        highestAllowedClaim: certification.highestAllowedClaim,
        requestedClaimAllowed: certification.requestedClaimAllowed,
        statusFlags: certification.statusFlags
      }
    : null,
  evidence: {
    contractPath: paths.contract,
    graphPath: paths.graph,
    stackArchitecture: paths.stackArchitecture,
    targetArchitecture: paths.targetArchitecture,
    parity: paths.parity,
    certification: paths.certification,
    recovery: paths.recovery,
    finalReport: paths.finalReport
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
  highestAllowedClaim: certification?.highestAllowedClaim || null,
  requestedClaimAllowed: certification?.requestedClaimAllowed || false,
  stages
};
const notificationState = loadJson(paths.notification, {
  delivered: false,
  deliveredAt: null,
  awaitingNotifier: allComplete,
  supervisorStatus: programState.supervisorStatus,
  highestAllowedClaim: certification?.highestAllowedClaim || null
});

fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
fs.mkdirSync(REPORTS_DIR, { recursive: true });
fs.writeFileSync(paths.programState, JSON.stringify(programState, null, 2));
fs.writeFileSync(paths.completionSummary, JSON.stringify(completionSummary, null, 2));
fs.writeFileSync(paths.notification, JSON.stringify(notificationState, null, 2));
fs.writeFileSync(`${REPORTS_DIR}/supervisor_status.json`, JSON.stringify({ truth, stages, certification: programState.certificationSummary }, null, 2));

console.log(JSON.stringify({ supervisorStatus: programState.supervisorStatus, matrixStatus: matrix.status, allComplete }, null, 2));
process.exit(allComplete ? 0 : 1);
