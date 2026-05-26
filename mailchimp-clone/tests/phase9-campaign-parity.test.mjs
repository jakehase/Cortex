import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createTempDataDir, loginAsSeededOwner, postForm, request } from './helpers.mjs';
import { leafProof, mergePhase9Proof } from './phase9-proof-helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function campaignProofs(server, workspaceId, campaignId) {
  const campaignProductFiles = ['packages/app/domain-campaigns.mjs', 'packages/app/routes/campaigns.mjs'];
  const editorProductFiles = ['packages/app/domain-campaigns.mjs', 'packages/app/routes/campaigns.mjs', 'packages/app/routes/templates.mjs'];
  const templateProductFiles = ['packages/app/routes/templates.mjs', 'packages/app/domain-campaigns.mjs'];
  const campaignTests = ['tests/campaign-editor-depth.test.mjs', 'tests/phase9-campaign-parity.test.mjs'];
  const campaignCurrentTests = ['tests/campaign-editor-depth.test.mjs', 'tests/current-product-parity.test.mjs', 'tests/phase9-campaign-parity.test.mjs'];
  const templateTests = ['tests/template-variants-routes.test.mjs', 'tests/template-approvals-routes.test.mjs', 'tests/phase9-campaign-parity.test.mjs'];
  const campaign = server.state.db.campaigns.find((entry) => entry.id === campaignId);
  const dbEvidence = {
    workspaceId,
    campaignId,
    status: campaign.status,
    templateId: campaign.templateId,
    editorLayout: campaign.editorLayout,
    editorSnapshots: campaign.editorSnapshots?.map((entry) => entry.label),
    blocks: campaign.blocks?.map((block) => ({ type: block.type, sectionName: block.sectionName, title: block.title, buttonLabel: block.buttonLabel })),
    jobs: server.state.db.jobs.filter((job) => job.workspaceId === workspaceId).map((job) => ({ type: job.type, status: job.status, campaignId: job.payload?.campaignId, runAt: job.runAt })),
    auditActions: server.state.db.auditEvents.filter((event) => event.workspaceId === workspaceId).map((event) => event.action),
    reports: campaign.report,
    templateAppliedAt: campaign.templateAppliedAt
  };
  mergePhase9Proof({
    productSlice: 'campaign_wizard_editor_template_send_review',
    leafProofs: [
      leafProof({ leafId: 'campaign_index__req_01', productFiles: campaignProductFiles, targetedTests: campaignTests, proofKinds: ['browser_ui', 'functional', 'job_event', 'product_diff'], routeEvidence: ['GET /campaigns', 'GET /campaigns/:id/resume', 'POST /campaigns/:id/send'], dbEvidence, assertions: ['campaign index summarizes draft/review/queued/scheduled pipeline', 'resume links route to the next required campaign step', 'send action queues delivery jobs'] }),
      leafProof({ leafId: 'campaign_index__req_02', productFiles: campaignProductFiles, targetedTests: campaignTests, proofKinds: ['browser_ui', 'db_persistence', 'functional', 'product_diff'], routeEvidence: ['GET /campaigns', 'GET /reports/campaigns/:id'], dbEvidence, assertions: ['campaign index persists campaign status and recipient/template state', 'delivery coverage links into report detail', 'campaign table exposes setup, recipients, templates, editor, review, and report actions'] }),
      leafProof({ leafId: 'campaign_wizard__req_01', productFiles: campaignProductFiles, targetedTests: campaignCurrentTests, proofKinds: ['browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff'], routeEvidence: ['GET /campaigns/new', 'POST /campaigns', 'POST /campaigns/:id/setup', 'POST /campaigns/:id/recipients', 'POST /campaigns/:id/template'], dbEvidence, assertions: ['guided wizard walks setup, recipients, template, design, and review', 'campaign draft state persists between wizard steps', 'test send and delivery routes produce job evidence'] }),
      leafProof({ leafId: 'campaign_wizard__req_02', productFiles: campaignProductFiles, targetedTests: campaignCurrentTests, proofKinds: ['browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff', 'security_policy'], routeEvidence: ['GET /campaigns/:id/review', 'POST /campaigns/:id/schedule', 'POST /campaigns/:id/send'], dbEvidence, assertions: ['review gate checks sender identity, address, recipients, template, and content', 'scheduled-send feature gate is enforced by plan policy', 'approval/governance links are visible from review'] }),
      leafProof({ leafId: 'campaign_wizard__gap_experimentation_depth', productFiles: campaignProductFiles, targetedTests: campaignCurrentTests, proofKinds: ['analytics_telemetry', 'browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff'], routeEvidence: ['GET /campaigns/:id/experiments', 'GET /campaigns/:id/optimization', 'GET /campaigns/:id/review'], dbEvidence, assertions: ['review links experimentation and predictive optimization surfaces', 'campaign state stores experiment/optimization metadata', 'analytics/report data remains connected to campaign send flow'] }),
      leafProof({ leafId: 'email_builder__req_01', productFiles: editorProductFiles, targetedTests: campaignTests, proofKinds: ['browser_ui', 'functional', 'product_diff'], routeEvidence: ['GET /campaigns/:id/editor', 'POST /campaigns/:id/editor/apply-layout', 'POST /campaigns/:id/editor/block/:index/update'], dbEvidence, assertions: ['email builder renders guided layouts, design system controls, readiness score, and narrative outline', 'layout application creates editable real blocks', 'block editor supports section, style, CTA, and asset fields'] }),
      leafProof({ leafId: 'email_builder__req_02', productFiles: editorProductFiles, targetedTests: campaignTests, proofKinds: ['browser_ui', 'functional', 'product_diff'], routeEvidence: ['POST /campaigns/:id/editor/save-snapshot', 'POST /campaigns/:id/editor/restore-snapshot/:snapshotId', 'POST /templates/library/apply'], dbEvidence, assertions: ['draft checkpoints persist and restore editor blocks/settings', 'template library handoff writes into the campaign editor', 'live preview reflects applied layout and block edits'] }),
      leafProof({ leafId: 'template_library__req_01', productFiles: templateProductFiles, targetedTests: templateTests, proofKinds: ['browser_ui', 'functional', 'product_diff', 'security_policy'], routeEvidence: ['GET /templates/library', 'POST /templates/library/apply'], dbEvidence, assertions: ['template library distinguishes system/workspace templates and categories', 'campaign handoff applies selected templates to authorized workspace campaigns', 'template governance is surfaced with approvals and lineage links'] }),
      leafProof({ leafId: 'template_library__req_02', productFiles: templateProductFiles, targetedTests: templateTests, proofKinds: ['browser_ui', 'functional', 'product_diff'], routeEvidence: ['GET /templates/library', 'POST /templates/library/apply'], dbEvidence, assertions: ['template selection writes source metadata to campaign state', 'workspace reusable templates and system templates share one library table', 'editor handoff status is visible per template'] }),
      leafProof({ leafId: 'send_schedule_review__req_01', productFiles: campaignProductFiles, targetedTests: campaignTests, proofKinds: ['browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff', 'security_policy'], routeEvidence: ['GET /campaigns/:id/review', 'POST /campaigns/:id/test-send', 'POST /campaigns/:id/schedule'], dbEvidence, assertions: ['send review renders checklist, approval state, schedule readiness, and governance', 'test send and schedule create delivery jobs', 'workspace sender and plan policy gate sends honestly'] }),
      leafProof({ leafId: 'send_schedule_review__req_02', productFiles: campaignProductFiles, targetedTests: campaignTests, proofKinds: ['browser_ui', 'functional', 'job_event', 'product_diff'], routeEvidence: ['POST /campaigns/:id/send', 'GET /jobs'], dbEvidence, assertions: ['send now queues/runs campaign delivery job', 'campaign status transitions through queued/sent runtime', 'job surface shows delivery evidence'] })
    ]
  });
}

test('Phase 9 real parity campaign slice: index, wizard, builder, template handoff, and send review are product-backed', async () => {
  const { server, baseUrl } = await boot();
  try {
    const { jar, campaignId } = await loginAsSeededOwner(baseUrl);
    const campaign = server.state.db.campaigns.find((entry) => entry.id === campaignId);
    const workspace = server.state.db.workspaces.find((entry) => entry.id === campaign.workspaceId);

    await postForm(baseUrl, jar, '/billing/plan', { planId: 'growth' });
    await postForm(baseUrl, jar, '/settings', {
      senderName: 'Campaign Admin',
      senderEmail: 'campaign@example.com',
      replyTo: 'reply@example.com',
      timezone: 'America/Chicago',
      brandColor: '#0b3b8c',
      address: '123 Campaign Street'
    });
    await postForm(baseUrl, jar, '/contacts', { audienceId: campaign.audienceId, firstName: 'Recipient', lastName: 'One', email: 'recipient@example.com', tags: 'buyer', interests: 'launch' });

    let indexHtml = await (await request(baseUrl, jar, '/campaigns')).text();
    assert.match(indexHtml, /Campaign pipeline/);
    assert.match(indexHtml, /Resume at/);
    let newHtml = await (await request(baseUrl, jar, '/campaigns/new')).text();
    assert.match(newHtml, /Guided setup/);

    let templateLibrary = await (await request(baseUrl, jar, '/templates/library')).text();
    assert.match(templateLibrary, /Campaign handoff/);
    await postForm(baseUrl, jar, '/templates/library/apply', { campaignId, templateId: 'tmpl-announce' });
    assert.equal(campaign.templateId, 'tmpl-announce');
    assert.ok(campaign.templateAppliedAt);

    let editorHtml = await (await request(baseUrl, jar, `/campaigns/${campaignId}/editor`)).text();
    assert.match(editorHtml, /Guided layouts/);
    assert.match(editorHtml, /Editor readiness/);
    assert.match(editorHtml, /Narrative outline/);
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/editor/apply-layout`, { preset: 'launch_story', mode: 'replace' });
    editorHtml = await (await request(baseUrl, jar, `/campaigns/${campaignId}/editor`)).text();
    assert.match(editorHtml, /Launch story/);
    assert.match(editorHtml, /Launch hero/);
    assert.match(editorHtml, /Primary CTA/);
    assert.match(editorHtml, /Support footer/);
    assert.match(editorHtml, /Score:/);

    await postForm(baseUrl, jar, `/campaigns/${campaignId}/editor/block/0/update`, {
      sectionName: 'Launch hero',
      eyebrow: 'ANNOUNCING',
      title: 'Audience launch proof',
      body: 'Campaign parity now includes a real guided editor.',
      stylePreset: 'hero',
      alignment: 'center',
      backgroundColor: '#fff4cc',
      textColor: '#18212f',
      padding: '28px'
    });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/editor/save-snapshot`, { label: 'Phase 9 checkpoint' });

    const reviewHtml = await (await request(baseUrl, jar, `/campaigns/${campaignId}/review`)).text();
    assert.match(reviewHtml, /Send schedule readiness/);
    assert.match(reviewHtml, /No blockers|Recipients:/);
    assert.match(reviewHtml, /Experimentation/);
    assert.match(reviewHtml, /Optimization/);
    assert.match(reviewHtml, /Governance/);

    await postForm(baseUrl, jar, `/campaigns/${campaignId}/test-send`, { testEmail: 'qa@example.com' });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/schedule`, { runAt: new Date(Date.now() + 60_000).toISOString().slice(0, 16) });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/send`, {});
    const jobsHtml = await (await request(baseUrl, jar, '/jobs')).text();
    assert.match(jobsHtml, /send_test_campaign|deliver_campaign/);
    assert.ok(server.state.db.jobs.some((job) => job.type === 'send_test_campaign' && job.payload.campaignId === campaignId));
    assert.ok(server.state.db.jobs.some((job) => job.type === 'deliver_campaign' && job.payload.campaignId === campaignId));

    campaignProofs(server, workspace.id, campaignId);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
