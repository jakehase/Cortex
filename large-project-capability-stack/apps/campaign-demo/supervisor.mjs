import fs from 'node:fs';
import path from 'node:path';
import { loadContract } from '../../packages/task-contract/index.mjs';
import { loadGraph } from '../../packages/issue-dag/index.mjs';
import { setSupervisor } from '../../packages/campaign-runtime/index.mjs';
import { compileSurfaceMatrix, saveMatrix } from '../../packages/surface-matrix/index.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const ARTIFACT_ROOT = process.env.LP_STACK_ARTIFACT_ROOT || path.join(ROOT, 'artifacts', 'demo-campaign');
const contractPath = path.join(ARTIFACT_ROOT, 'contract.json');
const graphPath = path.join(ARTIFACT_ROOT, 'issue_graph.json');
const statePath = path.join(ARTIFACT_ROOT, 'campaign_state.json');
const matrixPath = path.join(ARTIFACT_ROOT, 'surface_matrix.json');
const summaryPath = path.join(ARTIFACT_ROOT, 'supervisor_summary.json');

const contract = loadContract(contractPath);
const graph = loadGraph(graphPath);
const matrix = compileSurfaceMatrix({
  contract,
  graph,
  surfaces: [
    { id: 'demo.foundation', label: 'Demo foundation', issueIds: ['demo.foundation'], requiredArtifacts: [contractPath, graphPath] },
    { id: 'demo.delivery', label: 'Demo delivery', issueIds: ['demo.delivery'] }
  ]
});
saveMatrix(matrixPath, matrix);

const status = matrix.status === 'all_complete' ? 'green' : 'red';
const blocker = process.env.DEMO_BLOCKER || null;
const state = setSupervisor(statePath, { status, blocker, matrixStatus: matrix.status, note: 'demo supervisor derived from surface matrix' });
fs.writeFileSync(summaryPath, JSON.stringify({ status: state.supervisor.status, matrixStatus: matrix.status, blocker }, null, 2));
console.log(JSON.stringify({ status: state.supervisor.status, matrixStatus: matrix.status, blocker }, null, 2));
process.exit(state.stopAllowed || state.supervisor.status === 'green' ? 0 : 1);
