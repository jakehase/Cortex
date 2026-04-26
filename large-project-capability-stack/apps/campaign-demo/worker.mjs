import fs from 'node:fs';
import path from 'node:path';
import { compileTaskContract, saveContract } from '../../packages/task-contract/index.mjs';
import { createIssueGraph, upsertIssue, linkDependency, saveGraph, setIssueStatus } from '../../packages/issue-dag/index.mjs';
import { initializeCampaign, recoverCampaign, updateWorker } from '../../packages/campaign-runtime/index.mjs';
import { createLedger, appendLedgerEvent, writeCheckpoint } from '../../packages/recovery-ledger/index.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const ARTIFACT_ROOT = process.env.LP_STACK_ARTIFACT_ROOT || path.join(ROOT, 'artifacts', 'demo-campaign');
const contractPath = path.join(ARTIFACT_ROOT, 'contract.json');
const graphPath = path.join(ARTIFACT_ROOT, 'issue_graph.json');
const statePath = path.join(ARTIFACT_ROOT, 'campaign_state.json');
const ledgerPath = path.join(ARTIFACT_ROOT, 'ledger.json');

fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
const contract = saveContract(contractPath, compileTaskContract({
  anchor: 'demo campaign runtime script',
  targetPath: ROOT,
  requestedScope: ['demo worker', 'demo supervisor', 'demo notifier'],
  evidenceRequirements: ['state', 'graph', 'notification']
}));

let graph = createIssueGraph({ title: 'demo-campaign', targetPath: ROOT });
graph = upsertIssue(graph, { id: 'demo.foundation', title: 'foundation', lane: 'control', owner: 'worker', acceptanceCriteria: ['contract and graph exist'] });
graph = upsertIssue(graph, { id: 'demo.delivery', title: 'delivery', lane: 'execution', owner: 'worker', acceptanceCriteria: ['notifier may deliver'], deps: ['demo.foundation'] });
graph = linkDependency(graph, 'demo.delivery', 'demo.foundation');
graph = setIssueStatus(graph, 'demo.foundation', 'complete', [contractPath]);
if (!process.env.DEMO_LEAVE_PENDING) graph = setIssueStatus(graph, 'demo.delivery', 'complete');
saveGraph(graphPath, graph);

if (!fs.existsSync(ledgerPath)) createLedger(ledgerPath, { contractPath, graphPath });
appendLedgerEvent(ledgerPath, { type: 'worker-start', contractPath, graphPath });
writeCheckpoint(ledgerPath, 'after-worker', { readyIssues: graph.issues.map((issue) => ({ id: issue.id, status: issue.status })) });

const state = fs.existsSync(statePath)
  ? recoverCampaign(statePath, { contractPath, graphPath, ledgerPath })
  : initializeCampaign(statePath, { contractPath, graphPath, ledgerPath });
updateWorker(statePath, { id: 'worker.completed', ok: true, note: 'worker wrote graph and ledger', seenStateMode: state.mode });
console.log(JSON.stringify({ ok: true, artifactRoot: ARTIFACT_ROOT }, null, 2));
