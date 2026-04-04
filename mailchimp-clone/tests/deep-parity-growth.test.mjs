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

test('deep parity workflow: approval-gated campaign send, linked funnel reporting, and form-triggered automation runs', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Parity Admin',
      email: 'parity@example.com',
      password: 'secret123',
      workspaceName: 'Parity Lab'
    });
    await followRedirect(baseUrl, jar, signup);
    await postForm(baseUrl, jar, '/billing/plan', { planId: 'growth' });
    await postForm(baseUrl, jar, '/settings', {
      senderName: 'Parity Admin',
      senderEmail: 'parity@example.com',
      replyTo: 'reply@example.com',
      timezone: 'America/Chicago',
      brandColor: '#2255aa',
      address: '500 Clone St'
    });

    const audienceId = server.state.db.audiences[0].id;
    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'Robin',
      lastName: 'Launch',
      email: 'robin@example.com',
      tags: 'launch'
    });

    const createCampaign = await postForm(baseUrl, jar, '/campaigns', { name: 'Parity Campaign' });
    const campaignId = createCampaign.headers.get('location').match(/camp_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/setup`, {
      name: 'Parity Campaign',
      subject: 'Deep parity update',
      preheader: 'Workflow depth inside',
      fromName: 'Parity Admin',
      replyTo: 'reply@example.com'
    });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/recipients`, { audienceId, segmentId: '' });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/template`, { templateId: 'tmpl-announce' });

    await postForm(baseUrl, jar, '/approvals/request', {
      targetType: 'campaign',
      targetId: campaignId,
      title: 'Parity Campaign approval',
      note: 'Need governance sign-off',
      approversRequired: '1'
    });
    const blockedSend = await postForm(baseUrl, jar, `/campaigns/${campaignId}/send`, {});
    assert.equal(blockedSend.headers.get('location'), `/campaigns/${campaignId}/review`);
    assert.equal(server.state.db.jobs.length, 0);

    const approvalId = server.state.db.approvalRequests[0].id;
    await postForm(baseUrl, jar, `/approvals/${approvalId}/approve`, {});
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/send`, {});
    await waitFor(async () => {
      const jobs = await request(baseUrl, jar, '/jobs');
      const html = await jobs.text();
      assert.match(html, /deliver_campaign/);
      assert.match(html, /completed/);
      return true;
    });
    assert.equal(server.state.db.campaigns.find((entry) => entry.id === campaignId).status, 'sent');

    const formCreate = await postForm(baseUrl, jar, '/forms', {
      name: 'Parity Signup',
      audienceId,
      campaignId,
      tagsOnSubmit: 'parity,workflow'
    });
    const formId = formCreate.headers.get('location').match(/form_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, `/forms/${formId}/fields`, {
      name: 'firstName',
      label: 'First name',
      required: 'false'
    });
    await postForm(baseUrl, jar, `/forms/${formId}/publish`, {});
    const form = server.state.db.forms.find((entry) => entry.id === formId);

    const automationCreate = await postForm(baseUrl, jar, '/automations', {
      name: 'Follow-up Journey',
      audienceId,
      trigger: 'form_submitted'
    });
    const automationId = automationCreate.headers.get('location').match(/journey_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, `/automations/${automationId}/builder/nodes`, { type: 'email', title: 'Thanks for joining' });
    await postForm(baseUrl, jar, `/automations/${automationId}/builder/config`, {
      name: 'Follow-up Journey',
      audienceId,
      trigger: 'form_submitted',
      sourceFormId: formId,
      sourceCampaignId: campaignId,
      reentryPolicy: 'once_per_contact',
      goal: 'Capture qualified lead'
    });
    await postForm(baseUrl, jar, `/automations/${automationId}/publish`, {});

    const landingCreate = await postForm(baseUrl, jar, '/landing-pages', {
      name: 'Parity Landing',
      formId,
      campaignId
    });
    const landingId = landingCreate.headers.get('location').match(/lp_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, `/landing-pages/${landingId}`, {
      name: 'Parity Landing',
      slug: 'parity-landing',
      headline: 'Join the parity list',
      body: 'This landing page is tied to a campaign and a form.'
    });
    await postForm(baseUrl, jar, `/landing-pages/${landingId}/publish`, {});

    const publicLanding = await request(baseUrl, null, '/lp/parity-landing');
    assert.match(await publicLanding.text(), /Join the parity list/);

    const submit = await request(baseUrl, null, `/f/${form.slug}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'journey@example.com', firstName: 'Journey' })
    });
    assert.match(await submit.text(), /Thanks for signing up/);

    assert.equal(server.state.db.automationRuns.filter((entry) => entry.automationId === automationId).length, 1);
    const automation = server.state.db.automations.find((entry) => entry.id === automationId);
    assert.equal(automation.report.byTrigger.form_submitted, 1);
    assert.equal(automation.report.recentRuns[0].formId, formId);
    assert.equal(automation.report.recentRuns[0].campaignId, campaignId);

    const campaignReport = await request(baseUrl, jar, `/reports/campaigns/${campaignId}`);
    const campaignHtml = await campaignReport.text();
    assert.match(campaignHtml, /Linked growth funnel/);
    assert.match(campaignHtml, /Landing views: 1/);
    assert.match(campaignHtml, /Form submissions: 1/);

    const automationReport = await request(baseUrl, jar, `/reports/automations/${automationId}`);
    const automationHtml = await automationReport.text();
    assert.match(automationHtml, /Recent runs/);
    assert.match(automationHtml, /form_submitted/);
    assert.match(automationHtml, /Capture qualified lead/);

    const exportCsv = await request(baseUrl, jar, `/reports/export.csv?kind=campaign&id=${campaignId}`);
    assert.match(await exportCsv.text(), /form_submissions,1/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
