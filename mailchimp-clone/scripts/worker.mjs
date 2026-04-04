import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { saveContract } from '../../large-project-capability-stack/packages/task-contract/index.mjs';
import { createIssueGraph, saveGraph, upsertIssue, linkDependency, setIssueStatus } from '../../large-project-capability-stack/packages/issue-dag/index.mjs';
import { contractInput, issueDefinitions, ARTIFACT_ROOT, VALIDATION_DIR, REPORTS_DIR, QUALIFICATION_DIR, CONTRACT_PATH, GRAPH_PATH, WORKER_STATE_PATH, QUALIFICATION_PATH, REPORT_PATH } from './lib/full-clone-plan.mjs';

for (const dir of [ARTIFACT_ROOT, VALIDATION_DIR, REPORTS_DIR, QUALIFICATION_DIR]) fs.mkdirSync(dir, { recursive: true });

saveContract(CONTRACT_PATH, contractInput());

let graph = createIssueGraph({ title: 'mailchimp-full-clone-program-4-7', targetPath: contractInput().targetPath });
for (const issue of issueDefinitions()) graph = upsertIssue(graph, issue);
for (const issue of issueDefinitions()) for (const dep of issue.deps || []) graph = linkDependency(graph, issue.id, dep);

const commands = [
  { id: 'tests_platform', command: 'node --test tests/platform-spine.test.mjs' },
  { id: 'tests_audience', command: 'node --test tests/audience-core.test.mjs' },
  { id: 'tests_campaign', command: 'node --test tests/campaign-pipeline.test.mjs' },
  { id: 'tests_automation', command: 'node --test tests/automation-journeys.test.mjs' },
  { id: 'tests_forms_landing', command: 'node --test tests/forms-landing.test.mjs' },
  { id: 'tests_reports_admin', command: 'node --test tests/reports-admin.test.mjs' },
  { id: 'tests_architecture', command: 'node --test tests/architecture-hardening.test.mjs' },
  { id: 'live_smoke', command: 'node scripts/smoke-full-clone.mjs' }
];

const state = { role: 'worker', generatedAt: new Date().toISOString(), ok: true, steps: [] };

for (const entry of commands) {
  try {
    const output = execSync(entry.command, { cwd: contractInput().targetPath, encoding: 'utf8' });
    fs.writeFileSync(path.join(VALIDATION_DIR, `${entry.id}.log`), output);
    state.steps.push({ id: entry.id, command: entry.command, ok: true, log: `artifacts/mailchimp_clone/full_clone/validation/${entry.id}.log` });
  } catch (error) {
    state.ok = false;
    const output = `${error.stdout || ''}\n${error.stderr || error.message}`;
    fs.writeFileSync(path.join(VALIDATION_DIR, `${entry.id}.log`), output);
    state.steps.push({ id: entry.id, command: entry.command, ok: false, log: `artifacts/mailchimp_clone/full_clone/validation/${entry.id}.log` });
    break;
  }
}

const passed = Object.fromEntries(state.steps.map((step) => [step.id, step.ok]));
if (passed.tests_architecture) graph = setIssueStatus(graph, 'arch_refactor_foundation', 'complete', ['tests/architecture-hardening.test.mjs', 'apps/web/server.mjs']);
if (passed.tests_automation) graph = setIssueStatus(graph, 'program4_automation_journeys', 'complete', ['tests/automation-journeys.test.mjs']);
if (passed.tests_forms_landing) graph = setIssueStatus(graph, 'program5_forms_landing_pages', 'complete', ['tests/forms-landing.test.mjs']);
if (passed.tests_reports_admin) graph = setIssueStatus(graph, 'program6_reports_api_admin', 'complete', ['tests/reports-admin.test.mjs']);
if (state.ok && fs.existsSync(REPORT_PATH)) graph = setIssueStatus(graph, 'program7_hardening_regression', 'complete', ['docs/MAILCHIMP_FULL_CLONE_FINAL_REPORT_2026-04-02.md', 'artifacts/mailchimp_clone/full_clone/validation/live_smoke_full_clone.json']);

saveGraph(GRAPH_PATH, graph);
fs.writeFileSync(WORKER_STATE_PATH, JSON.stringify(state, null, 2));
fs.writeFileSync(QUALIFICATION_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), ok: state.ok, commands: state.steps, report: path.relative(contractInput().targetPath, REPORT_PATH) }, null, 2));
console.log(JSON.stringify({ ok: state.ok, steps: state.steps, graphPath: GRAPH_PATH }, null, 2));
process.exit(state.ok ? 0 : 1);
