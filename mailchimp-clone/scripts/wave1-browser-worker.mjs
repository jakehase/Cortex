import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { saveContract } from '../../large-project-capability-stack/packages/task-contract/index.mjs';
import { createIssueGraph, linkDependency, saveGraph, setIssueStatus, upsertIssue } from '../../large-project-capability-stack/packages/issue-dag/index.mjs';
import { initializeCampaign, updateWorker, claimWorkerIteration, completeWorkerIteration } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { appendLedgerEvent, createLedger, writeCheckpoint } from '../../large-project-capability-stack/packages/recovery-ledger/index.mjs';
import {
  ARTIFACT_ROOT,
  VALIDATION_DIR,
  REPORTS_DIR,
  RECOVERY_DIR,
  CONTRACT_PATH,
  GRAPH_PATH,
  MATRIX_PATH,
  PROGRAM_STATE_PATH,
  LEDGER_PATH,
  WORKER_STATE_PATH,
  REPORT_PATH,
  PROOF_PATH,
  REPO_TEST_LOG_PATH,
  contractInput,
  issueDefinitions
} from './lib/wave1-browser-foundation-plan.mjs';

for (const dir of [ARTIFACT_ROOT, VALIDATION_DIR, REPORTS_DIR, RECOVERY_DIR]) fs.mkdirSync(dir, { recursive: true });

saveContract(CONTRACT_PATH, contractInput());
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
if (!fs.existsSync(LEDGER_PATH)) createLedger(LEDGER_PATH, { contractPath: CONTRACT_PATH, graphPath: GRAPH_PATH });
claimWorkerIteration(PROGRAM_STATE_PATH, { claimedBy: 'scripts/wave1-browser-worker.mjs', reason: 'wave1_browser_foundation_run' });
appendLedgerEvent(LEDGER_PATH, { type: 'worker_started', note: 'Wave 1 browser foundation worker started.' });

let graph = createIssueGraph({ title: 'mailchimp-wave1-browser-foundation', targetPath: contractInput().targetPath });
for (const issue of issueDefinitions()) graph = upsertIssue(graph, issue);
for (const issue of issueDefinitions()) for (const dep of issue.deps || []) graph = linkDependency(graph, issue.id, dep);
saveGraph(GRAPH_PATH, graph);
writeCheckpoint(LEDGER_PATH, 'graph_initialized', { issueCount: graph.issues.length });

const state = { role: 'worker', generatedAt: new Date().toISOString(), ok: true, steps: [], blocker: null, proofSummary: null };

function runStep(id, command, logPath) {
  updateWorker(PROGRAM_STATE_PATH, { step: id, status: 'running', command });
  appendLedgerEvent(LEDGER_PATH, { type: 'step_running', id, command });
  try {
    const output = execSync(command, { cwd: contractInput().targetPath, encoding: 'utf8', stdio: 'pipe' });
    fs.writeFileSync(logPath, output);
    state.steps.push({ id, command, ok: true, log: path.relative(contractInput().targetPath, logPath) });
    updateWorker(PROGRAM_STATE_PATH, { step: id, status: 'complete', command, log: path.relative(contractInput().targetPath, logPath) });
    writeCheckpoint(LEDGER_PATH, `${id}_complete`, { log: logPath });
    return true;
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || error.message}`;
    fs.writeFileSync(logPath, output);
    state.ok = false;
    state.blocker = { step: id, command, message: error.message };
    state.steps.push({ id, command, ok: false, log: path.relative(contractInput().targetPath, logPath) });
    updateWorker(PROGRAM_STATE_PATH, { step: id, status: 'failed', command, log: path.relative(contractInput().targetPath, logPath), error: error.message });
    appendLedgerEvent(LEDGER_PATH, { type: 'step_failed', id, command, error: error.message });
    return false;
  }
}

if (runStep('repo_tests', 'npm test', REPO_TEST_LOG_PATH)) {
  graph = setIssueStatus(graph, 'browser_observability_shell', 'complete', ['packages/app/view.mjs', 'package.json']);
  graph = setIssueStatus(graph, 'real_browser_runtime', 'complete', ['package-lock.json', 'tests/browser-realism.test.mjs', 'scripts/lib/wave1-browser-proof.mjs']);
  saveGraph(GRAPH_PATH, graph);
}

if (state.ok && runStep('browser_proof', 'node scripts/run-wave1-browser-proof.mjs', path.join(VALIDATION_DIR, 'browser_proof_run.log'))) {
  const proof = JSON.parse(fs.readFileSync(PROOF_PATH, 'utf8'));
  state.proofSummary = {
    ok: proof.ok,
    realBrowser: proof.realBrowser,
    browserChecks: proof.browserChecks,
    realBrowserChecks: proof.realBrowserChecks,
    browserJourneyFamilies: proof.browserJourneyFamilies,
    coveredFamilies: proof.coveredFamilies
  };

  if (proof.ok && proof.realBrowser && proof.browserJourneyFamilies >= 6) {
    graph = setIssueStatus(graph, 'browser_journey_coverage', 'complete', ['tests/browser-realism.test.mjs', 'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/validation/browser_proof.json']);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    scope: 'Wave 1 browser realism foundation',
    status: proof.ok && proof.realBrowser && proof.browserJourneyFamilies >= 6 ? 'wave1_complete_for_scope' : 'partial',
    realBrowser: proof.realBrowser,
    browserChecks: proof.browserChecks,
    realBrowserChecks: proof.realBrowserChecks,
    browserJourneyFamilies: proof.browserJourneyFamilies,
    coveredFamilies: proof.coveredFamilies,
    screenshots: (proof.scenarios || []).map((scenario) => scenario.screenshot).filter(Boolean).map((filePath) => path.relative(contractInput().targetPath, filePath)),
    repoTestsLog: path.relative(contractInput().targetPath, REPO_TEST_LOG_PATH),
    proofPath: path.relative(contractInput().targetPath, PROOF_PATH),
    notes: 'Wave 1 is a browser-realism foundation only; this does not claim full project completion or real_world_indistinguishable.'
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  if (proof.ok && proof.realBrowser && proof.browserJourneyFamilies >= 6 && fs.existsSync(REPORT_PATH)) {
    graph = setIssueStatus(graph, 'browser_evidence_artifacts', 'complete', [
      'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/validation/browser_proof.json',
      'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/reports/wave1_browser_foundation_report.json'
    ]);
    graph = setIssueStatus(graph, 'wave1_supervision_and_runtime', 'complete', [
      'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/contract.json',
      'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/issue_graph.json',
      'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/worker_state.json',
      'artifacts/mailchimp_clone/real_world_indistinguishable/wave_1_browser_foundation/recovery/ledger.json'
    ]);
  }
  saveGraph(GRAPH_PATH, graph);
  writeCheckpoint(LEDGER_PATH, 'proof_summary', state.proofSummary);
}

fs.writeFileSync(WORKER_STATE_PATH, JSON.stringify(state, null, 2));
appendLedgerEvent(LEDGER_PATH, { type: 'worker_finished', ok: state.ok, blocker: state.blocker, proofSummary: state.proofSummary });
completeWorkerIteration(PROGRAM_STATE_PATH, {
  ok: state.ok,
  note: state.ok ? 'Wave 1 browser worker completed.' : 'Wave 1 browser worker failed.',
  outcome: state.proofSummary || state.blocker
});

console.log(JSON.stringify({ ok: state.ok, steps: state.steps, proofSummary: state.proofSummary, graphPath: GRAPH_PATH }, null, 2));
process.exit(state.ok ? 0 : 1);
