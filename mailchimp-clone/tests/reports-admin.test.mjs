import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request, waitFor } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('Program 6 reports, analytics, API/admin surfaces, export and history state', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Ops Admin',
      email: 'ops@example.com',
      password: 'secret123',
      workspaceName: 'Ops Lab'
    });
    await followRedirect(baseUrl, jar, signup);
    await postForm(baseUrl, jar, '/billing/plan', { planId: 'growth' });
    await postForm(baseUrl, jar, '/settings', {
      senderName: 'Ops Admin',
      senderEmail: 'ops@example.com',
      replyTo: 'reply@example.com',
      timezone: 'America/Chicago',
      brandColor: '#1144aa',
      address: '123 Main'
    });

    const audienceId = server.state.db.audiences[0].id;
    await postForm(baseUrl, jar, '/developer/webhooks', {
      targetUrl: 'https://example.test/hook',
      events: 'audit,notification:campaign-send'
    });
    await postForm(baseUrl, jar, '/developer/api-keys', { label: 'External integration' });

    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'Sam',
      lastName: 'Taylor',
      email: 'sam@example.com',
      tags: 'launch'
    });

    const campaignCreate = await postForm(baseUrl, jar, '/campaigns', { name: 'Ops Report Campaign' });
    const campaignId = campaignCreate.headers.get('location').match(/camp_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/setup`, {
      name: 'Ops Report Campaign',
      subject: 'Status update',
      preheader: 'Metrics inside',
      fromName: 'Ops Admin',
      replyTo: 'reply@example.com'
    });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/recipients`, { audienceId, segmentId: '' });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/template`, { templateId: 'tmpl-announce' });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/send`, {});
    await waitFor(async () => {
      const jobsPage = await request(baseUrl, jar, '/jobs');
      assert.match(await jobsPage.text(), /completed/);
      return true;
    });

    const automationCreate = await postForm(baseUrl, jar, '/automations', {
      name: 'Ops Journey',
      audienceId,
      trigger: 'contact_subscribed'
    });
    const automationId = automationCreate.headers.get('location').match(/journey_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, `/automations/${automationId}/builder/nodes`, { type: 'email', title: 'Ops welcome' });
    await postForm(baseUrl, jar, `/automations/${automationId}/publish`, {});

    const formCreate = await postForm(baseUrl, jar, '/forms', {
      name: 'Ops Signup',
      audienceId,
      tagsOnSubmit: 'ops'
    });
    const formId = formCreate.headers.get('location').match(/form_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, `/forms/${formId}/publish`, {});
    const form = server.state.db.forms.find((entry) => entry.id === formId);
    await request(baseUrl, null, `/f/${form.slug}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'opslead@example.com' })
    });

    const reports = await request(baseUrl, jar, '/reports');
    const reportsHtml = await reports.text();
    assert.match(reportsHtml, /Workspace metrics/);
    assert.match(reportsHtml, /Trend cards/);
    assert.match(reportsHtml, /averageOrderValue/);

    const campaignReport = await request(baseUrl, jar, `/reports/campaigns/${campaignId}`);
    const campaignReportHtml = await campaignReport.text();
    assert.match(campaignReportHtml, /Performance/);
    assert.match(campaignReportHtml, /Export CSV/);

    const csvExport = await request(baseUrl, jar, `/reports/export.csv?kind=campaign&id=${campaignId}`);
    assert.equal(csvExport.status, 200);
    assert.match(await csvExport.text(), /opens/);

    const apiKeysPage = await request(baseUrl, jar, '/developer/api-keys');
    const apiKeysHtml = await apiKeysPage.text();
    assert.match(apiKeysHtml, /External integration/);
    const generatedToken = apiKeysHtml.match(/key_[a-f0-9]+/)[0];
    const apiMe = await request(baseUrl, null, '/api/me', { headers: { authorization: `Bearer ${generatedToken}` } });
    const me = await apiMe.json();
    assert.equal(me.ok, true);

    const hooksPage = await request(baseUrl, jar, '/developer/webhooks');
    const hooksHtml = await hooksPage.text();
    assert.match(hooksHtml, /example.test\/hook/);
    assert.match(hooksHtml, /Delivery history/);

    await postForm(baseUrl, jar, '/admin/exports', { label: 'workspace-snapshot' });
    const exportEntry = server.state.db.exports[0];
    assert.ok(fs.existsSync(exportEntry.storagePath));

    const exportsPage = await request(baseUrl, jar, '/admin/exports');
    assert.match(await exportsPage.text(), /workspace-snapshot/);
    const systemPage = await request(baseUrl, jar, '/admin/system');
    assert.match(await systemPage.text(), /Trend state/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
