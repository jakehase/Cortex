import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from '../tests/helpers.mjs';
import { SMOKE_PATH, VALIDATION_DIR } from './lib/wave2-integration-enterprise-plan.mjs';

export async function runWave2IntegrationEnterpriseSmoke() {
  fs.mkdirSync(VALIDATION_DIR, { recursive: true });
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const jar = new CookieJar();
  const checklist = [];

  function record(id, ok, detail, extra = {}) {
    checklist.push({ id, ok, detail, ...extra });
  }

  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Wave Two Owner',
      email: 'wave2@example.com',
      password: 'secret123',
      workspaceName: 'Wave Two Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    await postForm(baseUrl, jar, '/settings', {
      senderName: 'Wave Two Owner',
      senderEmail: 'wave2@example.com',
      replyTo: 'reply@example.com',
      timezone: 'America/Chicago',
      brandColor: '#1144aa',
      address: '200 Market Street'
    });
    await postForm(baseUrl, jar, '/settings/domains', { domain: 'wave2.example.com' });
    const domainId = server.state.db.workspaces[0].settings.domains[0].id;
    await postForm(baseUrl, jar, `/settings/domains/${domainId}/verify`, {});
    await postForm(baseUrl, jar, `/settings/domains/${domainId}/authenticate`, {});
    await postForm(baseUrl, jar, `/settings/domains/${domainId}/default`, {});

    await postForm(baseUrl, jar, '/assets', {
      name: 'wave2-hero.txt',
      folder: 'Wave 2',
      contentType: 'text/plain',
      altText: 'Wave 2 hero',
      body: 'hero copy'
    });
    await postForm(baseUrl, jar, '/content/brand-kit', {
      name: 'Wave 2 brand kit',
      logoAssetName: 'wave2-hero.txt',
      primaryColor: '#1144aa',
      secondaryColor: '#111827',
      headingFont: 'Inter',
      bodyFont: 'Georgia'
    });
    await postForm(baseUrl, jar, '/content/templates', {
      name: 'Wave 2 internal brief',
      baseTemplateId: 'tmpl-newsletter',
      category: 'Internal',
      description: 'Wave 2 smoke template'
    });
    const contentPage = await request(baseUrl, jar, '/content');
    record('content.templates', contentPage.status === 200 && /Wave 2 brand kit/.test(await contentPage.text()), 'content studio page renders brand kit and template state');

    const campaignCreate = await postForm(baseUrl, jar, '/campaigns', { name: 'Wave 2 review campaign' });
    const campaignId = campaignCreate.headers.get('location').match(/camp_[a-f0-9]+/)[0];

    await postForm(baseUrl, jar, '/integrations/install', { appId: 'shopify' });
    const installationId = server.state.db.integrationInstallations[0].id;
    await postForm(baseUrl, jar, `/integrations/${installationId}/sync`, {});
    const integrationsPage = await request(baseUrl, jar, '/integrations');
    record('integrations.marketplace', integrationsPage.status === 200 && /Shopify/.test(await integrationsPage.text()), 'integrations marketplace shows installed connector and sync state');

    const storeId = server.state.db.commerceStores[0]?.id;
    const commercePage = await request(baseUrl, jar, '/commerce');
    record('commerce.revenue', commercePage.status === 200 && /Revenue attribution/.test(await commercePage.text()), 'commerce page shows revenue attribution surfaces', { storeId: storeId || null });

    await postForm(baseUrl, jar, '/approvals/request', {
      targetType: 'campaign',
      targetId: campaignId,
      title: 'Wave 2 executive approval',
      note: 'Review governance path',
      approversRequired: '1'
    });
    const approvalId = server.state.db.approvalRequests[0].id;
    await postForm(baseUrl, jar, `/approvals/${approvalId}/comment`, { comment: 'Looks ready for launch.' });
    await postForm(baseUrl, jar, `/approvals/${approvalId}/approve`, {});
    const approvalsPage = await request(baseUrl, jar, '/approvals');
    record('collaboration.approval', approvalsPage.status === 200 && /approved/.test(await approvalsPage.text()), 'approval queue supports request, comment, and approve flows');

    const initialDeliverabilityPage = await request(baseUrl, jar, '/deliverability');
    const initialDeliverabilityHtml = await initialDeliverabilityPage.text();
    const alertId = server.state.db.complianceAlerts[0]?.id || null;
    await postForm(baseUrl, jar, '/deliverability/suppressions', { email: 'hardbounce@example.com', reason: 'hard_bounce' });
    if (alertId) await postForm(baseUrl, jar, `/deliverability/alerts/${alertId}/resolve`, {});
    record('deliverability.compliance', /Inbox readiness/.test(initialDeliverabilityHtml), 'deliverability center renders inbox readiness and alerts');

    const workspaceHtml = await (await request(baseUrl, jar, '/workspaces')).text();
    const apiKey = workspaceHtml.match(/key_[a-f0-9]+/)[0];

    const integrationsApi = await request(baseUrl, null, '/api/integrations', { headers: { authorization: `Bearer ${apiKey}` } });
    const integrationsPayload = await integrationsApi.json();
    record('api.integrations', integrationsPayload.ok === true && integrationsPayload.integrations.length >= 1, 'integration API lists installed connectors');

    const revenueApi = await request(baseUrl, null, '/api/commerce/revenue', { headers: { authorization: `Bearer ${apiKey}` } });
    const revenuePayload = await revenueApi.json();
    record('api.commerce', revenuePayload.ok === true && revenuePayload.revenue.totalRevenue > 0, 'commerce revenue API returns attributed revenue summary');

    const approvalApi = await request(baseUrl, null, '/api/approvals', { headers: { authorization: `Bearer ${apiKey}` } });
    const approvalPayload = await approvalApi.json();
    record('api.approvals', approvalPayload.ok === true && approvalPayload.approvals.approved >= 1, 'approvals API reflects governance summary');

    const deliverabilityApi = await request(baseUrl, null, '/api/deliverability/health', { headers: { authorization: `Bearer ${apiKey}` } });
    const deliverabilityPayload = await deliverabilityApi.json();
    record('api.deliverability', deliverabilityPayload.ok === true && deliverabilityPayload.deliverability.score >= 70, 'deliverability API returns enterprise health score');

    const contentApi = await request(baseUrl, null, '/api/content/templates', { headers: { authorization: `Bearer ${apiKey}` } });
    const contentPayload = await contentApi.json();
    record('api.content', contentPayload.ok === true && contentPayload.content.savedTemplates >= 1, 'content API returns saved template inventory');

    const result = {
      generatedAt: new Date().toISOString(),
      ok: checklist.every((entry) => entry.ok),
      liveHttpChecks: checklist.length,
      surfaceFamiliesCovered: [
        'integrations_marketplace',
        'commerce_revenue',
        'deliverability_compliance',
        'collaboration_approval',
        'content_asset_templates'
      ],
      checklist
    };
    fs.writeFileSync(SMOKE_PATH, JSON.stringify(result, null, 2));
    return result;
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runWave2IntegrationEnterpriseSmoke();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
