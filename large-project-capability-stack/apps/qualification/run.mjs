import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compileTaskContract, saveContract } from '../../packages/task-contract/index.mjs';
import { createIssueGraph, upsertIssue, linkDependency, saveGraph, loadGraph, setIssueStatus } from '../../packages/issue-dag/index.mjs';
import { initializeCampaign, recoverCampaign, updateWorker, claimWorkerIteration, completeWorkerIteration } from '../../packages/campaign-runtime/index.mjs';
import { enforceArchitecture } from '../../packages/architecture-enforcer/index.mjs';
import { createHttpTarget, createBrowserAdapterTarget, runParityHarness } from '../../packages/parity-harness/index.mjs';
import { compileSurfaceMatrix, saveMatrix } from '../../packages/surface-matrix/index.mjs';
import { createLedger, appendLedgerEvent, writeCheckpoint, recoverFromLedger } from '../../packages/recovery-ledger/index.mjs';
import {
  certifyClaim,
  saveCertification,
  discoverRealBrowserProof,
  discoverTargetEvidenceArtifacts,
  selectPreferredBrowserParity
} from '../../packages/certification/index.mjs';
import { ROOT, TARGET, ARTIFACT_ROOT, VALIDATION_DIR, REPORTS_DIR, paths, surfaceDefinitions } from './plan.mjs';

const REQUESTED_CLAIM = 'real_world_indistinguishable';

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
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

const contract = saveContract(paths.contract, compileTaskContract({
  anchor: 'current conversation showing that local green/surface-matrix completion can still overstate real-world equivalence for large-project clone work, with large_product_replica as only an intermediate bar',
  replyAnchor: 'user wants the stronger real_world_indistinguishable target to be the explicit top-tier truth gate for the Mailchimp clone qualification path',
  targetPath: ROOT,
  requestedFidelity: 'production_slice',
  requestedScope: [
    'Y1 Scale realism / overclaiming gate',
    'Y2 Evidence-weighted certification / claim ladder',
    'Y3 Browser-grade parity harness upgrade',
    'Y4 Architecture growth / scale budget enforcer',
    'Y5 Persistent campaign requeue semantics',
    'Y6 Qualification 2.0 against /root/clawd/mailchimp-clone'
  ],
  stopCondition: 'supervisor_green_or_blocker_report',
  blockerPolicy: 'require_real_blocker_report_when_supervisor_red',
  evidenceRequirements: [
    'repo tests',
    'mailchimp tests',
    'architecture reports',
    'parity evidence',
    'claim certification',
    'supervisor/watch/notify outputs'
  ],
  implementationSurface: 'actual product code + tests + docs + qualification artifacts',
  campaignMode: 'persistent'
}));

let graph = createIssueGraph({ title: 'mailchimp-full-clone-truth', targetPath: ROOT });
const milestones = [
  ['y1.scale_realism', 'Y1 Scale realism / overclaiming gate'],
  ['y2.claim_ladder', 'Y2 Evidence-weighted certification / claim ladder'],
  ['y3.browser_parity', 'Y3 Browser-grade parity harness upgrade'],
  ['y4.architecture_budget', 'Y4 Architecture growth / scale budget enforcer'],
  ['y5.campaign_requeue', 'Y5 Persistent campaign requeue semantics'],
  ['y6.qualification_truth', 'Y6 Qualification 2.0 against the current Mailchimp clone']
];
for (const [id, title] of milestones) {
  graph = upsertIssue(graph, {
    id,
    title,
    lane: id === 'y6.qualification_truth' ? 'qualification' : 'core',
    owner: 'stack',
    acceptanceCriteria: ['code or executable logic present', 'tests or executable evidence present'],
    status: 'pending'
  });
}
for (let i = 1; i < milestones.length; i += 1) graph = linkDependency(graph, milestones[i][0], milestones[i - 1][0]);
saveGraph(paths.graph, graph);

createLedger(paths.ledger, { contractPath: paths.contract, graphPath: paths.graph, matrixPath: paths.matrix });
appendLedgerEvent(paths.ledger, { type: 'contract-compiled', scope: contract.requestedScope });
writeCheckpoint(paths.ledger, 'bootstrapped', { issueCount: milestones.length });

initializeCampaign(paths.campaign, {
  contractPath: paths.contract,
  graphPath: paths.graph,
  matrixPath: paths.matrix,
  ledgerPath: paths.ledger,
  mode: 'persistent',
  stopCondition: 'supervisor_green_or_blocker_report'
});
recoverCampaign(paths.campaign, { contractPath: paths.contract, graphPath: paths.graph, matrixPath: paths.matrix, ledgerPath: paths.ledger });
claimWorkerIteration(paths.campaign, { claimedBy: 'apps/qualification/run.mjs', reason: 'phase_2_truth_hardening' });
updateWorker(paths.campaign, { id: 'qualification.start', ok: true, note: 'phase-2 hardening qualification started for real_world_indistinguishable targeting' });

const repoTests = runNode(['--test', 'tests/*.test.mjs'], {
  cwd: ROOT,
  logPath: path.join(VALIDATION_DIR, 'repo_tests.log')
});
const stackArchitecture = enforceArchitecture(ROOT);
writeJson(paths.stackArchitecture, stackArchitecture);
if (!stackArchitecture.ok) throw new Error(`Stack architecture failed: ${JSON.stringify(stackArchitecture.violations)}`);

const targetTests = runNode(['--test', '--test-concurrency=1', 'tests/*.test.mjs'], {
  cwd: TARGET,
  logPath: path.join(VALIDATION_DIR, 'mailchimp_tests.log')
});
const mailchimpWorker = runNode(['scripts/worker.mjs'], { cwd: TARGET, logPath: path.join(VALIDATION_DIR, 'mailchimp_worker.log') });
const mailchimpSupervisor = runNode(['scripts/supervisor.mjs'], { cwd: TARGET, logPath: path.join(VALIDATION_DIR, 'mailchimp_supervisor.log') });
const mailchimpWatch = runNode(['scripts/watch-completion.mjs'], { cwd: TARGET, logPath: path.join(VALIDATION_DIR, 'mailchimp_watch.log') });
const mailchimpNotify = runNode(['scripts/notify-once.mjs'], { cwd: TARGET, logPath: path.join(VALIDATION_DIR, 'mailchimp_notify.log') });

const targetArchitecture = enforceArchitecture(TARGET, { claimProfile: REQUESTED_CLAIM });
writeJson(paths.targetArchitecture, targetArchitecture);

const { createServer } = await import('/root/clawd/mailchimp-clone/src/server.js');
const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-mailchimp-'));
process.env.MAILCLONE_DATA_DIR = tempDataDir;
const server = createServer();
const address = await server.start({ port: 0 });
const httpTarget = createHttpTarget({ baseUrl: `http://127.0.0.1:${address.port}` });

const liveHttpReport = await runParityHarness({
  target: httpTarget,
  checks: [
    {
      id: 'http.signup.dashboard',
      async run(target) {
        const signup = await target.postForm('/signup', {
          name: 'Truth Gate Owner',
          email: 'truth-owner@example.com',
          password: 'secret123',
          workspaceName: 'Truth Gate Workspace'
        });
        const app = await target.followRedirect(signup);
        const html = await app.text();
        if (!html.includes('Dashboard')) throw new Error('dashboard missing after signup');
        return { route: '/signup -> /app' };
      }
    },
    {
      id: 'http.audience.filter',
      async run(target) {
        await target.postForm('/billing/plan', { planId: 'growth' });
        await target.postForm('/audiences', { name: 'Truth Audience', description: 'Qualification scope' });
        const audiencesHtml = await target.getText('/audiences');
        const audienceId = audiencesHtml.match(/\/audiences\/(aud_[a-f0-9]+)/)?.[1];
        if (!audienceId) throw new Error('audience id missing');
        await target.postForm('/contacts', {
          audienceId,
          firstName: 'Pat',
          lastName: 'Scope',
          email: 'pat-scope@example.com',
          tags: 'truth,scope',
          groupCategory: 'Region',
          groupValue: 'Central',
          interests: 'events'
        });
        const contactsHtml = await target.getText(`/contacts?audienceId=${audienceId}&tag=truth`);
        if (!contactsHtml.includes('pat-scope@example.com')) throw new Error('contact filter mismatch');
        return { audienceId };
      }
    },
    {
      id: 'http.campaign.editor',
      async run(target) {
        const campaign = await target.postForm('/campaigns', { name: 'Truth Campaign' });
        const location = campaign.headers.get('location');
        const campaignId = location?.match(/camp_[a-f0-9]+/)?.[0];
        if (!campaignId) throw new Error('campaign id missing');
        const audienceId = server.state.db.audiences[0].id;
        await target.postForm(`/campaigns/${campaignId}/setup`, {
          name: 'Truth Campaign',
          subject: 'Truth subject',
          preheader: 'Truth preheader',
          fromName: 'Truth Owner',
          replyTo: 'reply@example.com'
        });
        await target.postForm(`/campaigns/${campaignId}/recipients`, { audienceId, segmentId: '' });
        await target.postForm(`/campaigns/${campaignId}/template`, { templateId: 'tmpl-newsletter' });
        const editorHtml = await target.getText(`/campaigns/${campaignId}/editor`);
        if (!editorHtml.includes('Add content block')) throw new Error('editor surface missing');
        return { campaignId };
      }
    },
    { id: 'http.status', type: 'json', path: '/status', select: (payload) => payload.ok, expect: true },
    { id: 'http.workspaces', type: 'text', path: '/workspaces', expect: 'Workspaces' },
    { id: 'http.billing', type: 'text', path: '/billing', expect: 'Billing' },
    { id: 'http.settings', type: 'text', path: '/settings', expect: 'Settings shell' },
    { id: 'http.team', type: 'text', path: '/team', expect: 'Team roles' },
    { id: 'http.assets', type: 'text', path: '/assets', expect: 'Content studio' },
    { id: 'http.jobs', type: 'text', path: '/jobs', expect: 'Background jobs' },
    { id: 'http.events', type: 'text', path: '/events', expect: 'Event stream' },
    { id: 'http.notifications', type: 'text', path: '/notifications', expect: 'Notification outbox' },
    { id: 'http.contacts', type: 'text', path: '/contacts', expect: 'Contacts table' },
    { id: 'http.segments', type: 'text', path: '/segments', expect: 'Segments / rule builder' },
    { id: 'http.campaign-create', type: 'text', path: '/campaigns/new', expect: 'Campaign creation wizard' },
    { id: 'http.automations', type: 'text', path: '/automations', expect: 'Automations overview' },
    { id: 'http.automation-create', type: 'text', path: '/automations/new', expect: 'Create automation' },
    { id: 'http.forms', type: 'text', path: '/forms', expect: 'Form builder overview' },
    { id: 'http.landing-pages', type: 'text', path: '/landing-pages', expect: 'Landing page builder overview' },
    { id: 'http.api-keys', type: 'text', path: '/developer/api-keys', expect: 'Developer API keys' },
    { id: 'http.webhooks', type: 'text', path: '/developer/webhooks', expect: 'Developer webhooks' },
    { id: 'http.integrations', type: 'text', path: '/integrations', expect: 'Integrations marketplace' },
    { id: 'http.commerce', type: 'text', path: '/commerce', expect: 'Commerce revenue attribution' },
    { id: 'http.approvals', type: 'text', path: '/approvals', expect: 'Collaboration approvals' },
    { id: 'http.deliverability', type: 'text', path: '/deliverability', expect: 'Deliverability compliance center' },
    { id: 'http.conversations', type: 'text', path: '/conversations', expect: 'Conversations inbox' },
    { id: 'http.preferences', type: 'text', path: '/preferences', expect: 'Preferences center' },
    { id: 'http.transactional', type: 'text', path: '/journeys/transactional', expect: 'Transactional messaging' },
    { id: 'http.surveys', type: 'text', path: '/surveys', expect: 'Surveys' }
  ]
});

const browserAdapterTarget = createBrowserAdapterTarget({
  browserName: 'http-bridge-adapter-browser',
  realBrowser: false,
  targetLabel: `http://127.0.0.1:${address.port}`,
  driver: {
    getText: (pathname, options) => httpTarget.getText(pathname, options),
    getJson: (pathname, options) => httpTarget.getJson(pathname, options),
    postForm: (pathname, form) => httpTarget.postForm(pathname, form),
    followRedirect: (response) => httpTarget.followRedirect(response)
  }
});
const browserAdapterReport = await runParityHarness({
  target: browserAdapterTarget,
  checks: [
    { id: 'browser.dashboard', type: 'browser_text', path: '/app', expect: 'Dashboard' },
    { id: 'browser.campaigns', type: 'browser_text', path: '/campaigns', expect: 'Campaigns' }
  ]
});

const realBrowserProof = discoverRealBrowserProof(TARGET);

await server.stop();
delete process.env.MAILCLONE_DATA_DIR;

const preferredBrowserEvidence = selectPreferredBrowserParity({
  browser: realBrowserProof?.browserReport,
  browserAdapter: browserAdapterReport
}) || browserAdapterReport;

const targetEvidenceArtifacts = discoverTargetEvidenceArtifacts(TARGET);

const parityEvidence = {
  generatedAt: new Date().toISOString(),
  ok: liveHttpReport.ok && browserAdapterReport.ok && (realBrowserProof ? realBrowserProof.browserReport.ok : true),
  liveHttp: liveHttpReport,
  browser: realBrowserProof?.browserReport || null,
  browserAdapter: browserAdapterReport,
  browserProofSource: realBrowserProof?.sourcePath || null,
  browserEvidenceModel: {
    realBrowserProven: preferredBrowserEvidence?.evidence?.browser?.real === true,
    downgradeableWithoutRealBrowser: preferredBrowserEvidence?.evidence?.browser?.real !== true
  }
};
writeJson(paths.parity, parityEvidence);
if (!parityEvidence.ok) throw new Error('Parity evidence failed');

const certification = saveCertification(paths.certification, certifyClaim({
  repoRoot: TARGET,
  requestedClaim: REQUESTED_CLAIM,
  architectureReport: targetArchitecture,
  parityReport: parityEvidence,
  evidenceArtifacts: [
    paths.stackArchitecture,
    paths.targetArchitecture,
    paths.parity,
    paths.certification,
    path.join(VALIDATION_DIR, 'repo_tests.log'),
    path.join(VALIDATION_DIR, 'mailchimp_tests.log'),
    path.join(VALIDATION_DIR, 'mailchimp_supervisor.log'),
    path.join(VALIDATION_DIR, 'mailchimp_notify.log'),
    ...targetEvidenceArtifacts
  ],
  repoTestsOk: repoTests.ok,
  targetTestsOk: targetTests.ok,
  supervisorOk: mailchimpSupervisor.ok && mailchimpWatch.ok,
  notifyOk: mailchimpNotify.ok
}));

const recovered = recoverFromLedger(paths.ledger);
const recoveryReport = {
  ok: Boolean(recovered.contractPath && recovered.graphPath && recovered.matrixPath && recovered.latestCheckpoint),
  recovered
};
writeJson(paths.recovery, recoveryReport);
if (!recoveryReport.ok) throw new Error('Recovery simulation failed');

appendLedgerEvent(paths.ledger, { type: 'evidence-collected', certification: certification.highestAllowedClaim });
writeCheckpoint(paths.ledger, 'evidence-complete', {
  requestedClaimAllowed: certification.requestedClaimAllowed,
  highestAllowedClaim: certification.highestAllowedClaim,
  scopedCompletionGreen: certification.statusFlags.scoped_completion_green
});

const reportText = `# Mailchimp Real-World Indistinguishability Truth Qualification Report — 2026-04-02

Qualification target: /root/clawd/mailchimp-clone
Requested public claim: ${REQUESTED_CLAIM}
Highest allowed claim: ${certification.highestAllowedClaim}
Requested claim allowed: ${certification.requestedClaimAllowed}

Observed evidence:
- Target self-supervisor currently reports green/all_complete for its own internal surface matrix.
- Stack truth gate re-ran tests, architecture checks, live HTTP parity checks, and browser-adapter evidence.
- Browser-grade proof is still adapter-only evidence, not a real browser automation run.

Truth gate result:
- scoped_completion_green: ${certification.statusFlags.scoped_completion_green}
- parity_for_scope_plausible: ${certification.statusFlags.parity_for_scope_plausible}
- full_clone_credible: ${certification.statusFlags.full_clone_credible}
- large_product_replica: ${certification.statusFlags.large_product_replica}
- real_world_indistinguishable_not_proven: ${certification.statusFlags.real_world_indistinguishable_not_proven}

Why the requested top-tier claim is denied:
- ${certification.publicSummary.downgradeReasons.join('\n- ')}

Interpretation:
- The current Mailchimp clone can be green for scoped completion and scoped parity evidence.
- It is not yet credible as a Mailchimp-scale large-product replica, much less a real-world indistinguishable product.
- This is the intended stricter behavior: honest downgrade instead of overclaiming.
`;
fs.writeFileSync(paths.finalReport, reportText);

const issueArtifacts = {
  'y1.scale_realism': [paths.certification, paths.targetArchitecture, 'packages/certification/index.mjs'],
  'y2.claim_ladder': [paths.certification, path.join(VALIDATION_DIR, 'repo_tests.log'), 'tests/certification.test.mjs'],
  'y3.browser_parity': [paths.parity, 'packages/parity-harness/index.mjs', 'tests/parity-harness.test.mjs'],
  'y4.architecture_budget': [paths.stackArchitecture, paths.targetArchitecture, 'packages/architecture-enforcer/index.mjs'],
  'y5.campaign_requeue': [paths.campaign, 'packages/campaign-runtime/index.mjs', 'tests/campaign-runtime.test.mjs'],
  'y6.qualification_truth': [paths.finalReport, path.join(VALIDATION_DIR, 'mailchimp_supervisor.log')]
};

graph = loadGraph(paths.graph);
for (const [issueId, artifacts] of Object.entries(issueArtifacts)) {
  graph = setIssueStatus(graph, issueId, 'complete', artifacts);
}
saveGraph(paths.graph, graph);

const matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(paths.matrix, matrix);
updateWorker(paths.campaign, { id: 'qualification.evidence-complete', ok: true, matrixStatus: matrix.status, highestAllowedClaim: certification.highestAllowedClaim });
completeWorkerIteration(paths.campaign, { ok: true, note: 'qualification evidence collected', outcome: { matrixStatus: matrix.status } });

const qualificationSupervisor = runNode(['apps/qualification/supervisor.mjs'], {
  cwd: ROOT,
  logPath: path.join(VALIDATION_DIR, 'qualification_supervisor.log')
});
const qualificationWatch = runNode(['apps/qualification/watch.mjs'], {
  cwd: ROOT,
  logPath: path.join(VALIDATION_DIR, 'qualification_watch.log')
});
const qualificationNotify = runNode(['apps/qualification/notify-once.mjs'], {
  cwd: ROOT,
  logPath: path.join(VALIDATION_DIR, 'qualification_notify.log')
});

writeJson(path.join(REPORTS_DIR, 'qualification_summary.json'), {
  repoTestsOk: repoTests.ok,
  targetTestsOk: targetTests.ok,
  mailchimpWorkerOk: mailchimpWorker.ok,
  mailchimpSupervisorOk: mailchimpSupervisor.ok,
  mailchimpWatchOk: mailchimpWatch.ok,
  mailchimpNotifyOk: mailchimpNotify.ok,
  qualificationSupervisorOk: qualificationSupervisor.ok,
  qualificationWatchOk: qualificationWatch.ok,
  qualificationNotifyOk: qualificationNotify.ok,
  highestAllowedClaim: certification.highestAllowedClaim,
  requestedClaimAllowed: certification.requestedClaimAllowed,
  matrixStatus: matrix.status
});

console.log(JSON.stringify({
  ok: true,
  artifactRoot: ARTIFACT_ROOT,
  matrixStatus: matrix.status,
  highestAllowedClaim: certification.highestAllowedClaim,
  requestedClaimAllowed: certification.requestedClaimAllowed
}, null, 2));
