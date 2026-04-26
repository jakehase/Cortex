import fs from 'node:fs';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request, waitFor } from '../tests/helpers.mjs';
import { SMOKE_PATH, VALIDATION_DIR } from './lib/full-clone-plan.mjs';

fs.mkdirSync(VALIDATION_DIR, { recursive: true });

const checklist = [];
function mark(id, ok, detail = '') { checklist.push({ id, ok, detail }); }

const dir = createTempDataDir('mailclone-smoke-');
process.env.MAILCLONE_DATA_DIR = dir;
const server = createServer();
const address = await server.start({ port: 0 });
const baseUrl = `http://127.0.0.1:${address.port}`;
const jar = new CookieJar();

try {
  const signup = await postForm(baseUrl, jar, '/signup', { name: 'Smoke Admin', email: 'smoke@example.com', password: 'secret123', workspaceName: 'Smoke Lab' });
  await followRedirect(baseUrl, jar, signup);
  mark('platform.signup', signup.status === 302, 'account creation and session bootstrap');
  const dashboardAlias = await request(baseUrl, jar, '/dashboard', { redirect: 'manual' });
  mark('platform.dashboard-alias', dashboardAlias.status === 302 && dashboardAlias.headers.get('location') === '/app', 'legacy dashboard route redirects into the canonical app shell');
  const audienceAlias = await request(baseUrl, jar, '/audience', { redirect: 'manual' });
  mark('audience.route-alias', audienceAlias.status === 302 && audienceAlias.headers.get('location') === '/audiences', 'legacy audience route redirects into the canonical audience overview');

  const audienceId = server.state.db.audiences[0].id;
  await postForm(baseUrl, jar, '/contacts', { audienceId, firstName: 'Casey', lastName: 'Smoke', email: 'casey@smoke.test', tags: 'smoke' });
  mark('audience.contact-create', Boolean(server.state.db.contacts.find((entry) => entry.email === 'casey@smoke.test')), 'manual contact create');

  const automationCreate = await postForm(baseUrl, jar, '/automations', { name: 'Smoke Journey', audienceId, trigger: 'contact_subscribed' });
  const automationId = automationCreate.headers.get('location').match(/journey_[a-f0-9]+/)[0];
  await postForm(baseUrl, jar, `/automations/${automationId}/builder/nodes`, { type: 'email', title: 'Smoke welcome' });
  await postForm(baseUrl, jar, `/automations/${automationId}/publish`, {});
  mark('program4.automation-publish', server.state.db.automations.find((entry) => entry.id === automationId).status === 'live', 'journey publish');

  const formCreate = await postForm(baseUrl, jar, '/forms', { name: 'Smoke Signup', audienceId, tagsOnSubmit: 'smoke-form' });
  const formId = formCreate.headers.get('location').match(/form_[a-f0-9]+/)[0];
  await postForm(baseUrl, jar, `/forms/${formId}/publish`, {});
  const form = server.state.db.forms.find((entry) => entry.id === formId);
  await request(baseUrl, null, `/f/${form.slug}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'form@smoke.test' }) });
  mark('program5.form-submission', Boolean(server.state.db.contacts.find((entry) => entry.email === 'form@smoke.test')), 'hosted signup flow');

  const campaignCreate = await postForm(baseUrl, jar, '/campaigns', { name: 'Smoke Blast' });
  const campaignId = campaignCreate.headers.get('location').match(/camp_[a-f0-9]+/)[0];
  await postForm(baseUrl, jar, '/billing/plan', { planId: 'growth' });
  await postForm(baseUrl, jar, '/settings', { senderName: 'Smoke Admin', senderEmail: 'smoke@example.com', replyTo: 'reply@example.com', timezone: 'America/Chicago', brandColor: '#112233', address: '123 Main' });
  await postForm(baseUrl, jar, `/campaigns/${campaignId}/setup`, { name: 'Smoke Blast', subject: 'Smoke subject', preheader: 'Smoke preheader', fromName: 'Smoke Admin', replyTo: 'reply@example.com' });
  await postForm(baseUrl, jar, `/campaigns/${campaignId}/recipients`, { audienceId, segmentId: '' });
  await postForm(baseUrl, jar, `/campaigns/${campaignId}/template`, { templateId: 'tmpl-announce' });
  await postForm(baseUrl, jar, `/campaigns/${campaignId}/send`, {});
  await waitFor(async () => {
    if (server.state.db.campaigns.find((entry) => entry.id === campaignId).status !== 'sent') throw new Error('campaign not sent yet');
    return true;
  });
  mark('program6.reported-send', server.state.db.campaigns.find((entry) => entry.id === campaignId).report.opens >= 1, 'campaign send drives report metrics');

  const reports = await request(baseUrl, jar, '/reports');
  const reportsHtml = await reports.text();
  mark('program6.reports-overview', /Workspace metrics/.test(reportsHtml) && /Trend cards/.test(reportsHtml), 'reports overview surface');

  await postForm(baseUrl, jar, `/campaigns/${campaignId}/ai/generate`, { tone: 'confident', goal: 'conversion' });
  const aiPackage = server.state.db.generatedSuggestions.find((entry) => entry.targetId === campaignId && entry.operation === 'campaign_setup');
  await postForm(baseUrl, jar, `/campaigns/${campaignId}/optimization`, { sendTimeWindow: '09:00-11:00 local', predictiveSegment: 'Likely next purchasers', fatigueGuardrail: '2 messages / 7 days', productRecommendation: 'Starter bundle' });
  await postForm(baseUrl, jar, `/campaigns/${campaignId}/experiments`, { name: 'Smoke experiment', winnerMetric: 'open_rate', dynamicRules: 'tag:smoke,interest:launch' });
  const experiment = server.state.db.campaignExperiments[0];
  await postForm(baseUrl, jar, `/campaigns/${campaignId}/experiments/${experiment.id}/run`, {});
  mark('current-product.campaign-ai-experimentation', Boolean(aiPackage) && Boolean(server.state.db.campaignExperiments[0]?.report?.winnerVariantId), 'AI assist + predictive optimization + experimentation routes');

  await postForm(baseUrl, jar, '/websites', { name: 'Smoke Site', slug: 'smoke-site', seoDescription: 'Smoke website parity' });
  const website = server.state.db.websites[0];
  await postForm(baseUrl, jar, `/websites/${website.id}/pages`, { name: 'About', slug: 'about', headline: 'Smoke site about', body: 'A real website surface.', linkedFormId: formId, linkedCampaignId: campaignId, showInNav: 'on' });
  await postForm(baseUrl, jar, `/websites/${website.id}/publish`, {});
  const publicSite = await request(baseUrl, null, '/sites/smoke-site/about');
  mark('current-product.website-builder', /Smoke Site/.test(await publicSite.text()), 'website builder distinct from landing pages');

  await postForm(baseUrl, jar, '/omnichannel', { name: 'Smoke SMS', channel: 'sms', audienceId, campaignId, budget: '100', content: 'Smoke follow-up' });
  const program = server.state.db.channelPrograms[0];
  await postForm(baseUrl, jar, `/omnichannel/${program.id}/launch`, {});
  mark('current-product.omnichannel', server.state.db.channelPrograms[0].status === 'live', 'omnichannel SMS/social/ads shell');

  await postForm(baseUrl, jar, '/content/snippets', { name: 'Smoke snippet', channel: 'email', tags: 'smoke,hero', content: 'Reusable smoke intro' });
  const contentDepth = await request(baseUrl, jar, '/content/depth?q=smoke');
  mark('current-product.content-depth', /Smoke snippet/.test(await contentDepth.text()), 'content lineage/snippet/version depth');

  await postForm(baseUrl, jar, '/integrations/install', { appId: 'shopify' });
  const installation = server.state.db.integrationInstallations[0];
  await postForm(baseUrl, jar, `/integrations/${installation.id}/auth`, { accountLabel: 'Smoke Store', authStatus: 'connected' });
  const integrationDetail = await request(baseUrl, jar, `/integrations/${installation.id}`);
  mark('current-product.integration-depth', /Field mapping/.test(await integrationDetail.text()), 'connector auth/config/mapping detail surface');

  await postForm(baseUrl, jar, '/conversations', {
    contactName: 'Support Lead',
    contactEmail: 'support@smoke.test',
    channel: 'email',
    subject: 'Priority renewal',
    priority: 'urgent',
    message: 'Customer asked about the renewal window.'
  });
  const conversationId = server.state.db.conversations[0].id;
  await postForm(baseUrl, jar, `/conversations/${conversationId}/reply`, { body: 'Renewal extended by one week.', status: 'waiting_on_customer' });
  mark('continuation.conversations-inbox', server.state.db.conversationMessages.some((entry) => entry.conversationId === conversationId && /extended/i.test(entry.body)), 'conversation inbox thread and reply');

  await postForm(baseUrl, jar, '/preferences/centers', { title: 'Smoke preferences', slug: 'smoke-preferences', topics: 'launches, webinars, offers' });
  await postForm(baseUrl, jar, '/preferences/profiles', { email: 'prefs@smoke.test', topics: 'launches, webinars', sms: 'on' });
  const preferenceProfile = server.state.db.preferenceProfiles[0];
  await request(baseUrl, null, `/preferences/${preferenceProfile.token}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'on', topics: 'launches' }) });
  mark('continuation.preferences-center', server.state.db.preferenceProfiles[0].subscriptions.topics.includes('launches') && server.state.db.preferenceProfiles[0].subscriptions.sms === false, 'hosted preference profile updates');

  await postForm(baseUrl, jar, '/journeys/transactional', { name: 'Receipt flow', trigger: 'order_created', channel: 'email', template: 'Receipt template' });
  const transactionalJourneyId = server.state.db.transactionalJourneys[0].id;
  await postForm(baseUrl, jar, `/journeys/transactional/${transactionalJourneyId}/status`, { status: 'live' });
  await postForm(baseUrl, jar, `/journeys/transactional/${transactionalJourneyId}/dispatch`, { recipient: 'buyer@smoke.test', eventKey: 'order_created', payload: '{"orderId":"smoke-1"}' });
  mark('continuation.transactional-messaging', server.state.db.transactionalDeliveries.some((entry) => entry.journeyId === transactionalJourneyId && entry.recipient === 'buyer@smoke.test'), 'transactional journey dispatch');

  await postForm(baseUrl, jar, '/surveys', { name: 'Smoke NPS', kind: 'nps', deliveryChannel: 'email', question: 'How likely are you to recommend us?' });
  const surveyId = server.state.db.surveyPrograms[0].id;
  await postForm(baseUrl, jar, `/surveys/${surveyId}/responses`, { email: 'fan@smoke.test', score: '9', comment: 'Quick setup and nice reporting.' });
  mark('continuation.surveys-feedback', server.state.db.surveyResponses.some((entry) => entry.surveyId === surveyId && entry.score === 9), 'survey feedback capture');

  const ok = checklist.every((entry) => entry.ok);
  fs.writeFileSync(SMOKE_PATH, JSON.stringify({ ok, generatedAt: new Date().toISOString(), checklist }, null, 2));
  console.log(JSON.stringify({ ok, checklist }, null, 2));
  process.exit(ok ? 0 : 1);
} finally {
  await server.stop();
  delete process.env.MAILCLONE_DATA_DIR;
}
