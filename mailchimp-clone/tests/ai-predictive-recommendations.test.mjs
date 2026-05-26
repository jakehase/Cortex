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

test('AI predictive recommendations build a provider runtime ledger, feature store, acceptance feedback, and campaign optimization path', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'AI Predictive Admin',
      email: 'ai-predictive@example.com',
      password: 'secret123',
      workspaceName: 'AI Predictive Lab'
    });
    await followRedirect(baseUrl, jar, signup);
    await postForm(baseUrl, jar, '/billing/plan', { planId: 'growth' });
    await postForm(baseUrl, jar, '/settings', {
      senderName: 'AI Predictive Admin',
      senderEmail: 'ai-predictive@example.com',
      replyTo: 'reply@example.com',
      timezone: 'America/Chicago',
      brandColor: '#3344aa',
      address: '700 Model Run St'
    });

    const audienceId = server.state.db.audiences[0].id;
    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'Jamie',
      lastName: 'Intent',
      email: 'jamie-intent@example.com',
      phone: '+15550001000',
      tags: 'vip,launch,repeat-buyer',
      interests: 'offers,events,product',
      notes: 'vip customer ready for offer'
    });
    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'Taylor',
      lastName: 'Warming',
      email: 'taylor-warming@example.com',
      tags: 'prospect',
      interests: 'product'
    });
    server.state.db.contacts.find((entry) => entry.email === 'jamie-intent@example.com').activity = ['morning open', 'clicked launch offer', 'visited pricing'];
    server.state.db.contacts.find((entry) => entry.email === 'taylor-warming@example.com').activity = ['opened newsletter'];

    const campaignCreate = await postForm(baseUrl, jar, '/campaigns', { name: 'AI Predictive Launch' });
    const campaignId = campaignCreate.headers.get('location').match(/camp_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/setup`, {
      name: 'AI Predictive Launch',
      subject: 'Launch subject',
      preheader: 'Launch preheader',
      fromName: 'AI Predictive Admin',
      replyTo: 'reply@example.com'
    });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/recipients`, { audienceId, segmentId: '' });
    await postForm(baseUrl, jar, '/automations', { name: 'AI Predictive Journey', audienceId, trigger: 'contact_subscribed' });

    const emptyPage = await request(baseUrl, jar, '/ai/predictive');
    const emptyHtml = await emptyPage.text();
    assert.match(emptyHtml, /AI predictive recommendations/);
    assert.match(emptyHtml, /Provider runtime/);
    assert.match(emptyHtml, /Feature store/);

    await postForm(baseUrl, jar, '/ai/predictive/refresh', {
      goal: 'increase launch conversion',
      audienceId,
      campaignId,
      productRecommendation: 'Launch bundle'
    });

    const run = server.state.db.aiRecommendationRuns[0];
    assert.ok(run.id.startsWith('airun_'));
    assert.equal(run.status, 'complete');
    assert.equal(run.target.campaignId, campaignId);
    assert.equal(run.providerRuntime.model, 'mailclone-predictive-orchestrator-v2');
    assert.ok(run.providerRuntime.evidenceContract.includes('feature_store_snapshot'));
    assert.equal(run.featureStore.aggregate.totalContacts, 2);
    assert.equal(run.featureStore.aggregate.highIntent, 1);
    assert.ok(run.recommendations.some((entry) => entry.category === 'campaign_optimization'));
    assert.ok(run.recommendations.some((entry) => entry.category === 'audience_prioritization'));
    assert.ok(run.lineage.featureColumns.includes('activity_count'));
    assert.equal(server.state.db.predictiveRecommendationSnapshots[0].runId, run.id);

    const campaignRecommendation = run.recommendations.find((entry) => entry.category === 'campaign_optimization');
    await postForm(baseUrl, jar, `/ai/predictive/recommendations/${campaignRecommendation.id}/apply`, { feedback: 'accepted' });
    const campaign = server.state.db.campaigns.find((entry) => entry.id === campaignId);
    assert.equal(campaign.optimization.source, 'ai_predictive_recommendation');
    assert.equal(campaign.optimization.recommendationId, campaignRecommendation.id);
    assert.equal(campaign.optimization.productRecommendation, 'Launch bundle');
    assert.equal(server.state.db.aiFeedbackEvents[0].recommendationId, campaignRecommendation.id);
    assert.equal(server.state.db.aiRecommendationRuns[0].acceptedRecommendations[0].appliedTarget.id, campaignId);

    const refreshedPage = await request(baseUrl, jar, '/ai/predictive');
    const refreshedHtml = await refreshedPage.text();
    assert.match(refreshedHtml, new RegExp(run.id));
    assert.match(refreshedHtml, /High-intent lifecycle contacts/);
    assert.match(refreshedHtml, /accepted/);

    const apiResponse = await request(baseUrl, jar, '/api/ai/predictive');
    assert.equal(apiResponse.status, 200);
    const api = await apiResponse.json();
    assert.equal(api.ok, true);
    assert.equal(api.report.latestRunId, run.id);
    assert.equal(api.report.featureStore.aggregate.highIntent, 1);
    assert.ok(api.report.acceptedCount >= 1);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
