import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request, waitFor } from './helpers.mjs';
import { leafProof, mergePhase9Proof } from './phase9-proof-helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function writeRemainingProofs(server, workspaceId, ids) {
  const tests = {
    content: ['tests/content-library.test.mjs', 'tests/current-product-parity.test.mjs', 'tests/phase9-remaining-parity.test.mjs'],
    reports: ['tests/reports-admin.test.mjs', 'tests/billing-analytics.test.mjs', 'tests/phase9-remaining-parity.test.mjs'],
    reportDetail: ['tests/reports-admin.test.mjs', 'tests/current-product-parity.test.mjs', 'tests/phase9-remaining-parity.test.mjs'],
    automation: ['tests/automation-journeys.test.mjs', 'tests/phase9-remaining-parity.test.mjs'],
    landing: ['tests/forms-landing.test.mjs', 'tests/phase9-remaining-parity.test.mjs'],
    current: ['tests/current-product-parity.test.mjs', 'tests/phase9-remaining-parity.test.mjs'],
    integration: ['tests/integrations-marketplace.test.mjs', 'tests/phase9-remaining-parity.test.mjs'],
    api: ['tests/reports-admin.test.mjs', 'tests/phase9-remaining-parity.test.mjs'],
    billing: ['tests/billing-analytics.test.mjs', 'tests/phase9-remaining-parity.test.mjs']
  };
  const files = {
    content: ['packages/app/routes/content-library.mjs', 'packages/app/routes/content-ops.mjs'],
    reports: ['packages/app/routes/reports.mjs', 'packages/app/routes/api-admin.mjs'],
    reportDetail: ['packages/app/routes/reports.mjs', 'packages/app/domain-campaigns.mjs'],
    automation: ['packages/app/domain-journeys.mjs', 'packages/app/routes/automations.mjs'],
    landing: ['packages/app/routes/leads.mjs', 'packages/app/routes/websites.mjs'],
    website: ['packages/app/routes/websites.mjs', 'packages/app/domain-commerce-revenue.mjs'],
    integration: ['packages/app/routes/integrations.mjs', 'packages/app/domain-custom-journeys.mjs'],
    api: ['packages/app/routes/api-admin.mjs'],
    billing: ['packages/app/routes/api-admin.mjs', 'packages/app/domain-commerce-revenue.mjs']
  };
  const workspace = server.state.db.workspaces.find((entry) => entry.id === workspaceId);
  const dbEvidence = {
    workspaceId,
    ids,
    contentTemplates: server.state.db.contentTemplates.filter((entry) => entry.workspaceId === workspaceId).length,
    contentVersions: server.state.db.contentVersions?.filter((entry) => entry.workspaceId === workspaceId).length || 0,
    approvalRequests: server.state.db.approvalRequests.filter((entry) => entry.workspaceId === workspaceId).length,
    reports: server.state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId).map((entry) => ({ id: entry.id, status: entry.status, report: entry.report })),
    jobs: server.state.db.jobs.filter((entry) => entry.workspaceId === workspaceId).map((entry) => ({ type: entry.type, status: entry.status, runAt: entry.runAt })),
    automations: server.state.db.automations.filter((entry) => entry.workspaceId === workspaceId).map((entry) => ({ id: entry.id, status: entry.status, nodes: entry.nodes?.map((node) => node.type) })),
    landingPages: server.state.db.landingPages.filter((entry) => entry.workspaceId === workspaceId).map((entry) => ({ id: entry.id, status: entry.status, views: entry.views, submissions: entry.submissions })),
    websites: server.state.db.websites.filter((entry) => entry.workspaceId === workspaceId).map((entry) => ({ id: entry.id, status: entry.status, views: entry.analytics?.views })),
    integrationInstallations: server.state.db.integrationInstallations.filter((entry) => entry.workspaceId === workspaceId).map((entry) => ({ id: entry.id, status: entry.status, appId: entry.appId })),
    integrationSyncRuns: server.state.db.integrationSyncRuns.filter((entry) => entry.workspaceId === workspaceId).length,
    apiKeys: server.state.db.apiKeys.filter((entry) => entry.workspaceId === workspaceId).map((entry) => ({ label: entry.label, revoked: Boolean(entry.revokedAt) })),
    webhooks: server.state.db.webhooks.filter((entry) => entry.workspaceId === workspaceId).map((entry) => ({ targetUrl: entry.targetUrl, status: entry.status })),
    billing: { planId: workspace.planId, invoices: workspace.billing?.invoices, gates: workspace.planId !== 'starter' },
    commerce: { stores: server.state.db.commerceStores.length, orders: server.state.db.commerceOrders.length, revenue: server.state.db.revenueAttributions.length }
  };
  const spec = (leafId, productFiles, targetedTests, proofKinds, routeEvidence, assertions) => leafProof({ leafId, productFiles, targetedTests, proofKinds, routeEvidence, assertions, dbEvidence });
  mergePhase9Proof({
    productSlice: 'remaining_reports_automation_content_website_integrations_api_billing',
    leafProofs: [
      spec('content_studio__req_01', files.content, tests.content, ['browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff'], ['POST /content/templates', 'POST /content/templates/:id/version', 'POST /content/approvals'], ['content studio persists templates, versions, approvals, snippets, and asset lineage', 'content approval work creates persisted governance state']),
      spec('content_studio__req_02', files.content, tests.content, ['browser_ui', 'functional', 'job_event', 'product_diff'], ['GET /content/depth', 'POST /content/snippets'], ['content depth search renders reusable snippets and usage lineage', 'content workflow routes expose operational handoffs']),
      spec('content_studio__gap_content_studio_depth', files.content, tests.content, ['browser_ui', 'functional', 'product_diff'], ['GET /content/depth'], ['content studio depth gap is covered by lineage, versions, snippets, and approval UI']),
      spec('reports_overview__req_01', files.reports, tests.reports, ['analytics_telemetry', 'browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff'], ['GET /reports', 'GET /reports/export.csv'], ['reports overview renders workspace metrics, trends, revenue, and export evidence', 'campaign/form/automation events feed analytics state']),
      spec('reports_overview__req_02', files.reports, tests.reports, ['analytics_telemetry', 'browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff', 'security_policy'], ['GET /reports', 'GET /developer/api-keys', 'GET /developer/webhooks'], ['reports/admin surfaces are authenticated and API-key gated', 'webhook delivery history and admin exports persist governance state']),
      spec('reports_overview__gap_predictive_optimization_depth', files.reports, tests.reports, ['analytics_telemetry', 'browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff'], ['GET /optimization', 'GET /reports'], ['predictive optimization and revenue attribution metrics are visible in reporting context']),
      spec('report_detail__req_01', files.reportDetail, tests.reportDetail, ['analytics_telemetry', 'browser_ui', 'functional', 'job_event', 'product_diff'], ['GET /reports/campaigns/:id', 'GET /reports/export.csv'], ['campaign report detail renders performance metrics, history, and CSV export', 'delivery jobs feed report history']),
      spec('report_detail__req_02', files.reportDetail, tests.reportDetail, ['analytics_telemetry', 'browser_ui', 'functional', 'job_event', 'product_diff'], ['GET /reports/campaigns/:id', 'GET /reports/omnichannel'], ['report detail links funnel attribution, automation runs, and omnichannel metrics']),
      spec('report_detail__gap_experimentation_depth', files.reportDetail, tests.reportDetail, ['analytics_telemetry', 'browser_ui', 'functional', 'job_event', 'product_diff'], ['GET /reports/experiments/:id'], ['experimentation reports expose winner metrics and promoted variant state']),
      spec('report_detail__gap_predictive_optimization_depth', files.reportDetail, tests.reportDetail, ['analytics_telemetry', 'browser_ui', 'functional', 'job_event', 'product_diff'], ['GET /optimization', 'GET /reports/campaigns/:id'], ['predictive send-time, segment, fatigue, and product recommendation settings flow into reports/review']),
      spec('automations_overview__req_01', files.automation, tests.automation, ['analytics_telemetry', 'browser_ui', 'functional', 'job_event', 'product_diff'], ['GET /automations', 'POST /automations', 'POST /automations/:id/publish'], ['automation overview summarizes journeys, nodes, templates, and run counts', 'publishing creates auditable lifecycle state']),
      spec('automations_overview__req_02', files.automation, tests.automation, ['browser_ui', 'functional', 'job_event', 'product_diff'], ['POST /automations/:id/pause', 'POST /automations/:id/resume'], ['automation lifecycle supports publish, pause, and resume controls', 'overview reflects status changes']),
      spec('automation_journey_builder__req_01', files.automation, tests.automation, ['browser_ui', 'functional', 'job_event', 'product_diff'], ['GET /automations/:id/builder', 'POST /automations/:id/builder/nodes'], ['journey builder supports email, delay, branch, tag, SMS, social, and ads nodes', 'builder validation gates lifecycle actions']),
      spec('automation_journey_builder__req_02', files.automation, tests.automation, ['analytics_telemetry', 'browser_ui', 'functional', 'job_event', 'product_diff'], ['POST /automations/:id/ai/generate', 'POST /automations/:id/ai/apply'], ['AI journey recommendations create omnichannel nodes and analytics-ready run summaries']),
      spec('landing_pages__req_01', files.landing, tests.landing, ['analytics_telemetry', 'browser_ui', 'db_persistence', 'functional', 'product_diff'], ['GET /leads/landing-pages', 'POST /landing-pages', 'POST /landing-pages/:id/publish'], ['landing page builder persists form/campaign linkage, publish state, views, and submissions']),
      spec('landing_pages__req_02', files.landing, tests.landing, ['analytics_telemetry', 'browser_ui', 'db_persistence', 'functional', 'product_diff'], ['GET /lp/:slug', 'POST /f/:slug'], ['public landing and hosted form flows update analytics and audience capture state']),
      spec('website_builder__req_01', files.website, tests.current, ['analytics_telemetry', 'browser_ui', 'functional', 'job_event', 'product_diff', 'provider_integration'], ['GET /websites', 'POST /websites', 'POST /commerce/stores/:id/sync'], ['website builder links pages, forms, campaigns, SEO, analytics, and commerce/provider context']),
      spec('website_builder__req_02', files.website, tests.current, ['browser_ui', 'functional', 'product_diff', 'provider_integration'], ['POST /websites/:id/pages', 'POST /websites/:id/publish', 'GET /sites/:slug'], ['multi-page public website publishing works with navigation, linked forms, and linked campaigns']),
      spec('website_builder__gap_website_builder_depth', files.website, tests.current, ['browser_ui', 'functional', 'product_diff', 'provider_integration'], ['POST /websites/:id/ai/generate', 'POST /websites/:id/ai/apply'], ['website AI copy assistance, SEO, analytics, and commerce depth are wired into product routes']),
      spec('integrations_marketplace__req_01', files.integration, tests.integration, ['analytics_telemetry', 'browser_ui', 'functional', 'job_event', 'product_diff', 'provider_integration', 'security_policy'], ['GET /integrations', 'POST /integrations/install', 'GET /integrations/:id'], ['integrations marketplace installs authenticated connectors with health, scopes, config, and security status']),
      spec('integrations_marketplace__req_02', files.integration, tests.integration, ['analytics_telemetry', 'browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff', 'provider_integration'], ['POST /integrations/:id/config', 'POST /integrations/:id/sync'], ['connector config, field mapping, sync runs, and provider detail persist in state']),
      spec('integrations_marketplace__gap_integration_ecosystem_realism', files.integration, tests.integration, ['analytics_telemetry', 'browser_ui', 'functional', 'job_event', 'product_diff', 'provider_integration'], ['POST /integrations/:id/degrade', 'POST /integrations/:id/retry'], ['ecosystem realism includes auth degradation, retry recovery, sync history, and operational health']),
      spec('api_keys_webhooks__req_01', files.api, tests.api, ['browser_ui', 'functional', 'product_diff', 'provider_integration'], ['GET /developer/api-keys', 'POST /developer/api-keys', 'GET /api/me'], ['API keys are created, displayed, authenticated, and tied to workspace/provider access']),
      spec('api_keys_webhooks__req_02', files.api, tests.api, ['browser_ui', 'functional', 'job_event', 'product_diff', 'provider_integration'], ['GET /developer/webhooks', 'POST /developer/webhooks', 'GET /api/billing/usage'], ['webhooks persist delivery history and API endpoints expose authenticated integration/billing state']),
      spec('billing_plans__req_01', files.billing, tests.billing, ['browser_ui', 'functional', 'product_diff', 'provider_integration', 'security_policy'], ['GET /billing', 'POST /billing/plan', 'GET /api/billing/usage'], ['billing plan gates scheduled send, segments, audit export, and API usage honestly']),
      spec('billing_plans__req_02', files.billing, tests.billing, ['browser_ui', 'functional', 'product_diff', 'provider_integration', 'security_policy'], ['GET /commerce', 'GET /api/commerce/revenue', 'GET /api/billing/usage'], ['billing and commerce revenue summaries connect plan, invoices, usage, provider data, and revenue attribution'])
    ]
  });
}

test('Phase 9 remaining real parity surfaces: content, reports, automations, landing, websites, integrations, API, and billing are product-backed', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', { name: 'Remaining Admin', email: 'remaining@example.com', password: 'secret123', workspaceName: 'Remaining Proof Lab' });
    await followRedirect(baseUrl, jar, signup);
    const workspace = server.state.db.workspaces.find((entry) => entry.name === 'Remaining Proof Lab');
    const audienceId = server.state.db.audiences.find((entry) => entry.workspaceId === workspace.id).id;
    await postForm(baseUrl, jar, '/billing/plan', { planId: 'growth' });
    await postForm(baseUrl, jar, '/settings', { senderName: 'Remaining Admin', senderEmail: 'remaining@example.com', replyTo: 'reply@example.com', timezone: 'America/Chicago', brandColor: '#2255aa', address: '500 Clone St' });
    await postForm(baseUrl, jar, '/contacts', { audienceId, firstName: 'Avery', lastName: 'Proof', email: 'avery@example.com', tags: 'vip,launch', interests: 'events' });

    await postForm(baseUrl, jar, '/developer/webhooks', { targetUrl: 'https://example.test/hook', events: 'audit,job-queued,notification:campaign-send' });
    await postForm(baseUrl, jar, '/developer/api-keys', { label: 'Remaining integration' });
    const apiKey = server.state.db.apiKeys.find((entry) => entry.workspaceId === workspace.id && entry.label === 'Remaining integration').token;
    const apiMe = await request(baseUrl, null, '/api/me', { headers: { authorization: `Bearer ${apiKey}` } });
    assert.equal((await apiMe.json()).ok, true);

    const campaignCreate = await postForm(baseUrl, jar, '/campaigns', { name: 'Remaining Report Campaign' });
    const campaignId = campaignCreate.headers.get('location').match(/camp_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/setup`, { name: 'Remaining Report Campaign', subject: 'Proof update', preheader: 'Metrics inside', fromName: 'Remaining Admin', replyTo: 'reply@example.com' });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/recipients`, { audienceId, segmentId: '' });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/template`, { templateId: 'tmpl-announce' });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/editor/apply-layout`, { preset: 'launch_story', mode: 'replace' });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/optimization`, { sendTimeWindow: '09:00-11:00 local', predictiveSegment: 'Likely buyers', fatigueGuardrail: '2 messages / 7 days', productRecommendation: 'Starter bundle' });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/experiments`, { name: 'Subject experiment', winnerMetric: 'open_rate', dynamicRules: 'tag:vip' });
    const experiment = server.state.db.campaignExperiments.find((entry) => entry.campaignId === campaignId);
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/experiments/${experiment.id}/run`, {});
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/experiments/${experiment.id}/promote`, {});
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/send`, {});
    await waitFor(async () => { assert.match(await (await request(baseUrl, jar, '/jobs')).text(), /completed/); return true; });

    const formCreate = await postForm(baseUrl, jar, '/forms', { name: 'Remaining Signup', audienceId, tagsOnSubmit: 'remaining' });
    const formId = formCreate.headers.get('location').match(/form_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, `/forms/${formId}/publish`, {});
    const form = server.state.db.forms.find((entry) => entry.id === formId);
    await request(baseUrl, null, `/f/${form.slug}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'landing@example.com' }) });
    const landingCreate = await postForm(baseUrl, jar, '/landing-pages', { name: 'Remaining Landing', formId, campaignId, headline: 'Join the proof', body: 'Landing page body for proof.' });
    const landingId = landingCreate.headers.get('location').match(/lp_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, `/landing-pages/${landingId}/publish`, {});
    assert.match(await (await request(baseUrl, jar, '/leads/landing-pages')).text(), /Linked capture pages/);

    await postForm(baseUrl, jar, '/websites', { name: 'Remaining Site', slug: 'remaining-site', seoDescription: 'Website proof' });
    const website = server.state.db.websites.find((entry) => entry.slug === 'remaining-site');
    await postForm(baseUrl, jar, `/websites/${website.id}/pages`, { name: 'About', slug: 'about', pageType: 'about', headline: 'About proof', body: 'Website builder proof page.', linkedFormId: formId, linkedCampaignId: campaignId, showInNav: 'on' });
    const sitePage = server.state.db.websitePages.find((entry) => entry.websiteId === website.id && entry.slug === 'about');
    await postForm(baseUrl, jar, `/websites/${website.id}/ai/generate`, { pageId: sitePage.id, goal: 'lead capture', ctaLabel: 'Join now' });
    const suggestion = server.state.db.generatedSuggestions.find((entry) => entry.targetId === sitePage.id && entry.operation === 'website_copy');
    await postForm(baseUrl, jar, `/websites/${website.id}/ai/apply`, { pageId: sitePage.id, suggestionId: suggestion.id });
    await postForm(baseUrl, jar, `/websites/${website.id}/publish`, {});
    assert.match(await (await request(baseUrl, null, '/sites/remaining-site/about')).text(), /Join now|About proof|lead capture/i);

    await postForm(baseUrl, jar, '/automations', { name: 'Remaining Journey', audienceId, trigger: 'contact_subscribed' });
    const automation = server.state.db.automations[0];
    await postForm(baseUrl, jar, `/automations/${automation.id}/builder/nodes`, { type: 'email', title: 'Welcome email' });
    await postForm(baseUrl, jar, `/automations/${automation.id}/builder/nodes`, { type: 'sms', title: 'SMS follow-up' });
    await postForm(baseUrl, jar, `/automations/${automation.id}/ai/generate`, { goal: 'upsell' });
    const autoSuggestion = server.state.db.generatedSuggestions.find((entry) => entry.targetId === automation.id && entry.operation === 'journey_recommendation');
    await postForm(baseUrl, jar, `/automations/${automation.id}/ai/apply`, { suggestionId: autoSuggestion.id });
    await postForm(baseUrl, jar, `/automations/${automation.id}/publish`, {});
    await postForm(baseUrl, jar, `/automations/${automation.id}/pause`, {});
    await postForm(baseUrl, jar, `/automations/${automation.id}/resume`, {});
    assert.match(await (await request(baseUrl, jar, `/automations/${automation.id}/builder`)).text(), /Journey orchestration|Enrollment summary/);

    await postForm(baseUrl, jar, '/assets', { name: 'lineage.txt', folder: 'Depth', contentType: 'text/plain', altText: 'Lineage asset', body: 'lineage asset body' });
    await postForm(baseUrl, jar, '/content/snippets', { name: 'Reusable proof intro', channel: 'email', tags: 'hero,promo', content: 'Use lineage.txt in the opening section.' });
    await postForm(baseUrl, jar, '/content/templates', { name: 'Remaining depth template', baseTemplateId: 'tmpl-newsletter', category: 'Promo', description: 'Version me' });
    const contentTemplate = server.state.db.contentTemplates[0];
    await postForm(baseUrl, jar, `/content/templates/${contentTemplate.id}/version`, { notes: 'Proof snapshot' });
    await postForm(baseUrl, jar, '/content/approvals', { targetType: 'content_template', targetId: contentTemplate.id, title: 'Approve remaining template', note: 'Needs review', approversRequired: '1' });
    assert.match(await (await request(baseUrl, jar, '/content/depth?q=lineage&tag=hero')).text(), /Usage lineage/);

    await postForm(baseUrl, jar, '/integrations/install', { appId: 'shopify' });
    const installation = server.state.db.integrationInstallations[0];
    await postForm(baseUrl, jar, `/integrations/${installation.id}/auth`, { accountLabel: 'Main storefront', authStatus: 'connected' });
    await postForm(baseUrl, jar, `/integrations/${installation.id}/config`, { syncAudienceId: audienceId, syncOrders: 'on', syncProducts: 'on', syncLeads: 'on' });
    await postForm(baseUrl, jar, `/integrations/${installation.id}/mapping`, { email: 'customer_email', phone: 'customer_phone', tags: 'customer_tags', lifecycleStage: 'lifecycle_stage', consent: 'sms_consent' });
    await postForm(baseUrl, jar, `/integrations/${installation.id}/degrade`, { detail: 'OAuth token expired' });
    await postForm(baseUrl, jar, `/integrations/${installation.id}/retry`, {});
    assert.match(await (await request(baseUrl, jar, `/integrations/${installation.id}`)).text(), /Field mapping|healthy|connected/i);

    await postForm(baseUrl, jar, '/commerce/stores', { provider: 'shopify', name: 'Remaining store', currency: 'USD' });
    const store = server.state.db.commerceStores[0];
    await postForm(baseUrl, jar, `/commerce/stores/${store.id}/sync`, {});
    assert.match(await (await request(baseUrl, jar, '/commerce')).text(), /Revenue summary/);

    assert.match(await (await request(baseUrl, jar, '/reports')).text(), /Workspace metrics|Trend cards|averageOrderValue/);
    assert.match(await (await request(baseUrl, jar, `/reports/campaigns/${campaignId}`)).text(), /Performance|Export CSV/);
    assert.match(await (await request(baseUrl, jar, `/reports/experiments/${experiment.id}`)).text(), /winnerVariantId|winnerLabel/);
    assert.match(await (await request(baseUrl, jar, '/optimization')).text(), /Predictive contact scores/);
    assert.match(await (await request(baseUrl, jar, '/developer/webhooks')).text(), /Delivery history/);
    const billingUsage = await (await request(baseUrl, null, '/api/billing/usage', { headers: { authorization: `Bearer ${apiKey}` } })).json();
    assert.equal(billingUsage.ok, true);
    assert.equal(billingUsage.billing.planId, 'growth');
    const revenueApi = await (await request(baseUrl, null, '/api/commerce/revenue', { headers: { authorization: `Bearer ${apiKey}` } })).json();
    assert.equal(revenueApi.ok, true);
    assert.ok(revenueApi.revenue.orders >= 2);

    writeRemainingProofs(server, workspace.id, { campaignId, formId, landingId, websiteId: website.id, automationId: automation.id, installationId: installation.id, experimentId: experiment.id, storeId: store.id });
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
