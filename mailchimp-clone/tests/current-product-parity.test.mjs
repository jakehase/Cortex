import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('current-product parity: website builder, AI assist, experimentation, predictive optimization, and omnichannel depth are wired into the main app shell', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Current Product Admin',
      email: 'current@example.com',
      password: 'secret123',
      workspaceName: 'Current Product Lab'
    });
    await followRedirect(baseUrl, jar, signup);
    await postForm(baseUrl, jar, '/billing/plan', { planId: 'growth' });
    await postForm(baseUrl, jar, '/settings', {
      senderName: 'Current Product Admin',
      senderEmail: 'current@example.com',
      replyTo: 'reply@example.com',
      timezone: 'America/Chicago',
      brandColor: '#2255aa',
      address: '500 Clone St'
    });

    const audienceId = server.state.db.audiences[0].id;
    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'Jamie',
      lastName: 'Launch',
      email: 'jamie@example.com',
      phone: '+15551234567',
      tags: 'vip,launch',
      interests: 'news,offers',
      notes: 'vip customer'
    });
    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'Taylor',
      lastName: 'Test',
      email: 'taylor@example.com',
      tags: 'prospect',
      interests: 'launch'
    });

    const formCreate = await postForm(baseUrl, jar, '/forms', {
      name: 'Website Signup',
      audienceId,
      tagsOnSubmit: 'website'
    });
    const formId = formCreate.headers.get('location').match(/form_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, `/forms/${formId}/publish`, {});

    const campaignCreate = await postForm(baseUrl, jar, '/campaigns', { name: 'Current Product Blast' });
    const campaignId = campaignCreate.headers.get('location').match(/camp_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/setup`, {
      name: 'Current Product Blast',
      subject: 'Initial subject',
      preheader: 'Initial preheader',
      fromName: 'Current Product Admin',
      replyTo: 'reply@example.com'
    });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/recipients`, { audienceId, segmentId: '' });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/template`, { templateId: 'tmpl-announce' });

    await postForm(baseUrl, jar, '/assets', {
      name: 'hero.txt',
      folder: 'Launch assets',
      contentType: 'text/plain',
      altText: 'Hero asset',
      body: 'hero asset body'
    });
    const assetId = server.state.db.assets[0].id;
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/editor/block/0/update`, {
      title: 'Launch headline',
      body: 'Original campaign body with hero asset mention.',
      buttonLabel: '',
      buttonUrl: '',
      assetId,
      backgroundColor: '#ffffff',
      textAlign: 'left',
      padding: '18px'
    });

    await postForm(baseUrl, jar, `/campaigns/${campaignId}/ai/generate`, { tone: 'confident', goal: 'conversion' });
    const aiPackage = server.state.db.generatedSuggestions.find((entry) => entry.targetId === campaignId && entry.operation === 'campaign_setup');
    assert.ok(aiPackage);
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/ai/apply`, {
      packageId: aiPackage.id,
      field: 'subject',
      value: aiPackage.suggestions.subject[0].text
    });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/ai/apply`, {
      packageId: aiPackage.id,
      field: 'block_body',
      index: '0',
      value: aiPackage.suggestions.blocks[0][0].body
    });
    assert.equal(server.state.db.campaigns.find((entry) => entry.id === campaignId).subject, aiPackage.suggestions.subject[0].text);
    assert.match(server.state.db.campaigns.find((entry) => entry.id === campaignId).blocks[0].body, /Rewrite|Condense|Use a/);

    await postForm(baseUrl, jar, `/campaigns/${campaignId}/optimization`, {
      sendTimeWindow: '09:00-11:00 local',
      predictiveSegment: 'Likely next purchasers',
      fatigueGuardrail: '2 messages / 7 days',
      productRecommendation: 'Starter bundle'
    });
    const optimizationPage = await request(baseUrl, jar, '/optimization');
    assert.match(await optimizationPage.text(), /Predictive contact scores/);
    assert.match(await (await request(baseUrl, jar, `/campaigns/${campaignId}/review`)).text(), /Likely next purchasers/);

    await postForm(baseUrl, jar, `/campaigns/${campaignId}/experiments`, {
      name: 'Subject experiment',
      winnerMetric: 'open_rate',
      dynamicRules: 'tag:vip,interest:launch'
    });
    const experiment = server.state.db.campaignExperiments.find((entry) => entry.campaignId === campaignId);
    assert.ok(experiment);
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/experiments/${experiment.id}/run`, {});
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/experiments/${experiment.id}/promote`, {});
    const promotedCampaign = server.state.db.campaigns.find((entry) => entry.id === campaignId);
    assert.ok(promotedCampaign.experimentWinnerId);
    const experimentReport = await request(baseUrl, jar, `/reports/experiments/${experiment.id}`);
    assert.match(await experimentReport.text(), /winnerVariantId|winnerLabel/);

    await postForm(baseUrl, jar, '/websites', {
      name: 'Current Product Site',
      slug: 'current-product-site',
      seoDescription: 'A richer website builder surface'
    });
    const website = server.state.db.websites.find((entry) => entry.slug === 'current-product-site');
    assert.ok(website);
    await postForm(baseUrl, jar, `/websites/${website.id}/pages`, {
      name: 'About',
      slug: 'about',
      pageType: 'about',
      headline: 'About the launch',
      body: 'This website links into the broader marketing stack and mentions hero.txt.',
      linkedFormId: formId,
      linkedCampaignId: campaignId,
      showInNav: 'on'
    });
    const aboutPage = server.state.db.websitePages.find((entry) => entry.websiteId === website.id && entry.slug === 'about');
    await postForm(baseUrl, jar, `/websites/${website.id}/ai/generate`, { pageId: aboutPage.id, goal: 'lead capture', ctaLabel: 'Join now' });
    const websiteSuggestion = server.state.db.generatedSuggestions.find((entry) => entry.targetId === aboutPage.id && entry.operation === 'website_copy');
    assert.ok(websiteSuggestion);
    await postForm(baseUrl, jar, `/websites/${website.id}/ai/apply`, { pageId: aboutPage.id, suggestionId: websiteSuggestion.id });
    await postForm(baseUrl, jar, `/websites/${website.id}/publish`, {});
    assert.equal(server.state.db.websites.find((entry) => entry.id === website.id).status, 'published');
    const publicHome = await request(baseUrl, null, '/sites/current-product-site');
    assert.match(await publicHome.text(), /Current Product Site/);
    const publicAbout = await request(baseUrl, null, '/sites/current-product-site/about?ref=campaign');
    const aboutHtml = await publicAbout.text();
    assert.match(aboutHtml, /lead capture|Join now|About the launch/);
    assert.ok(server.state.db.websites.find((entry) => entry.id === website.id).analytics.views >= 2);

    await postForm(baseUrl, jar, '/automations', {
      name: 'Current Product Journey',
      audienceId,
      trigger: 'contact_subscribed'
    });
    const automation = server.state.db.automations[0];
    await postForm(baseUrl, jar, `/automations/${automation.id}/ai/generate`, { goal: 'upsell' });
    const automationSuggestion = server.state.db.generatedSuggestions.find((entry) => entry.targetId === automation.id && entry.operation === 'journey_recommendation');
    await postForm(baseUrl, jar, `/automations/${automation.id}/ai/apply`, { suggestionId: automationSuggestion.id });
    assert.ok(server.state.db.automations.find((entry) => entry.id === automation.id).nodes.some((node) => node.type === 'sms'));
    assert.ok(server.state.db.automations.find((entry) => entry.id === automation.id).nodes.some((node) => node.type === 'social'));

    await postForm(baseUrl, jar, '/omnichannel', {
      name: 'VIP SMS Follow-up',
      channel: 'sms',
      audienceId,
      campaignId,
      budget: '150',
      content: 'Short follow-up message'
    });
    const program = server.state.db.channelPrograms[0];
    await postForm(baseUrl, jar, `/omnichannel/${program.id}/launch`, {});
    assert.equal(server.state.db.channelPrograms[0].status, 'live');
    const omnichannelReport = await request(baseUrl, jar, '/reports/omnichannel');
    assert.match(await omnichannelReport.text(), /conversions|sms/i);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});

test('current-product parity: content depth and integration realism expose deeper workflows in the primary app shell', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Ecosystem Admin',
      email: 'ecosystem@example.com',
      password: 'secret123',
      workspaceName: 'Ecosystem Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    await postForm(baseUrl, jar, '/assets', {
      name: 'lineage.txt',
      folder: 'Depth',
      contentType: 'text/plain',
      altText: 'Lineage asset',
      body: 'lineage asset body'
    });

    await postForm(baseUrl, jar, '/content/snippets', {
      name: 'Reusable intro',
      channel: 'email',
      tags: 'hero,promo',
      content: 'Use lineage.txt in the opening section.'
    });
    await postForm(baseUrl, jar, '/content/templates', {
      name: 'Depth template',
      baseTemplateId: 'tmpl-newsletter',
      category: 'Promo',
      description: 'Version me'
    });
    const workspaceTemplate = server.state.db.contentTemplates[0];
    await postForm(baseUrl, jar, `/content/templates/${workspaceTemplate.id}/version`, { notes: 'Launch snapshot' });
    await postForm(baseUrl, jar, '/content/approvals', {
      targetType: 'content_template',
      targetId: workspaceTemplate.id,
      title: 'Approve depth template',
      note: 'Needs review',
      approversRequired: '1'
    });
    const contentDepth = await request(baseUrl, jar, '/content/depth?q=lineage&tag=hero');
    const contentHtml = await contentDepth.text();
    assert.match(contentHtml, /Reusable intro/);
    assert.match(contentHtml, /Usage lineage/);
    assert.equal(server.state.db.contentVersions.length, 1);
    assert.equal(server.state.db.approvalRequests[0].targetType, 'content_template');

    await postForm(baseUrl, jar, '/integrations/install', { appId: 'shopify' });
    const installation = server.state.db.integrationInstallations[0];
    await postForm(baseUrl, jar, `/integrations/${installation.id}/auth`, {
      accountLabel: 'Main storefront',
      authStatus: 'connected'
    });
    await postForm(baseUrl, jar, `/integrations/${installation.id}/config`, {
      syncAudienceId: server.state.db.audiences[0].id,
      syncOrders: 'on',
      syncProducts: 'on',
      syncLeads: 'on'
    });
    await postForm(baseUrl, jar, `/integrations/${installation.id}/mapping`, {
      email: 'customer_email',
      phone: 'customer_phone',
      tags: 'customer_tags',
      lifecycleStage: 'lifecycle_stage',
      consent: 'sms_consent'
    });
    await postForm(baseUrl, jar, `/integrations/${installation.id}/degrade`, { detail: 'OAuth token expired' });
    let detail = await request(baseUrl, jar, `/integrations/${installation.id}`);
    let detailHtml = await detail.text();
    assert.match(detailHtml, /OAuth token expired/);
    assert.match(detailHtml, /Field mapping/);

    await postForm(baseUrl, jar, `/integrations/${installation.id}/retry`, {});
    detail = await request(baseUrl, jar, `/integrations/${installation.id}`);
    detailHtml = await detail.text();
    assert.match(detailHtml, /healthy|connected/i);
    assert.equal(server.state.db.integrationSyncRuns.length >= 1, true);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
