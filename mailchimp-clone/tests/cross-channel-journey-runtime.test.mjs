import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CROSS_CHANNEL_JOURNEY_RUNTIME_CONTRACT, buildCrossChannelJourneyRuntimeSnapshot } from '../packages/app/domain-journeys.mjs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('cross-channel journey runtime records channel nodes, handoffs, decisions, rollups, snapshots, and API evidence', async () => {
  assert.equal(CROSS_CHANNEL_JOURNEY_RUNTIME_CONTRACT.surfaceId, 'cross_channel_journey_runtime_layer');
  assert.ok(CROSS_CHANNEL_JOURNEY_RUNTIME_CONTRACT.supportedNodeTypes.includes('ad_sync'));
  assert.ok(CROSS_CHANNEL_JOURNEY_RUNTIME_CONTRACT.supportedNodeTypes.includes('survey_request'));

  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Cross Channel Owner',
      email: 'cross-channel@example.com',
      password: 'secret123',
      workspaceName: 'Cross Channel Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const audienceId = server.state.db.audiences[0].id;
    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'Casey',
      lastName: 'Journey',
      email: 'casey-journey@example.com',
      tags: 'vip,cross-channel',
      interests: 'offers'
    });

    const created = await postForm(baseUrl, jar, '/automations', {
      name: 'Cross-channel retention journey',
      audienceId,
      trigger: 'contact_subscribed',
      goal: 'Recover VIP shoppers'
    });
    const automationId = created.headers.get('location').match(/journey_[a-f0-9]+/)[0];

    await postForm(baseUrl, jar, `/automations/${automationId}/builder/nodes`, {
      type: 'email',
      title: 'Email offer',
      conditions: 'subscribed'
    });
    await postForm(baseUrl, jar, `/automations/${automationId}/builder/nodes`, {
      type: 'sms',
      title: 'SMS reminder',
      conditions: 'sms_opted_in,not_purchased'
    });
    await postForm(baseUrl, jar, `/automations/${automationId}/builder/nodes`, {
      type: 'ad_sync',
      title: 'Sync ad audience',
      conditions: 'clicked_no_purchase'
    });
    await postForm(baseUrl, jar, `/automations/${automationId}/builder/nodes`, {
      type: 'inbox_task',
      title: 'Create inbox task',
      conditions: 'high_value'
    });
    await postForm(baseUrl, jar, `/automations/${automationId}/builder/nodes`, {
      type: 'survey_request',
      title: 'Request feedback',
      conditions: 'completed_purchase'
    });
    await postForm(baseUrl, jar, `/automations/${automationId}/builder/nodes`, {
      type: 'postcard',
      title: 'Send postcard follow-up',
      conditions: 'postal_eligible'
    });

    assert.equal(server.state.db.crossChannelJourneyNodeEvents.length, 6);
    const automation = server.state.db.automations.find((entry) => entry.id === automationId);
    assert.equal(automation.nodes.some((node) => node.type === 'ad_sync'), true);
    assert.equal(automation.crossChannelRuntime.channelNodeCount, 6);

    await postForm(baseUrl, jar, `/automations/${automationId}/publish`, {});
    assert.equal(server.state.db.automations.find((entry) => entry.id === automationId).status, 'live');

    const runtimePage = await request(baseUrl, jar, `/automations/${automationId}/cross-channel`);
    const runtimeHtml = await runtimePage.text();
    assert.match(runtimeHtml, /Cross-channel journey runtime/);
    assert.match(runtimeHtml, /SMS reminder/);
    assert.match(runtimeHtml, /Sync ad audience/);

    await postForm(baseUrl, jar, `/automations/${automationId}/cross-channel/handoff`, {
      channel: 'sms',
      provider: 'mailclone_sms',
      recipientCount: '1',
      status: 'sent'
    });
    await postForm(baseUrl, jar, `/automations/${automationId}/cross-channel/handoff`, {
      channel: 'ads',
      provider: 'mailclone_ads',
      recipientCount: '1',
      status: 'accepted'
    });
    await postForm(baseUrl, jar, `/automations/${automationId}/cross-channel/decision`, {
      selectedChannel: 'sms',
      branch: 'vip_sms_eligible',
      reason: 'matched SMS consent and no purchase rule',
      evidence: 'sms_consent,not_purchased'
    });
    await postForm(baseUrl, jar, `/automations/${automationId}/cross-channel/performance`, {
      channel: 'sms',
      touchpoints: '1',
      delivered: '1',
      clicks: '1',
      conversions: '1',
      revenue: '49'
    });
    await postForm(baseUrl, jar, `/automations/${automationId}/cross-channel/performance`, {
      channel: 'ads',
      touchpoints: '1',
      delivered: '1',
      clicks: '0',
      conversions: '0',
      revenue: '0'
    });

    const runtimeApi = await request(baseUrl, jar, `/api/automations/${automationId}/cross-channel-runtime`);
    assert.equal(runtimeApi.status, 200);
    const payload = await runtimeApi.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.crossChannelRuntime.surfaceId, 'cross_channel_journey_runtime_layer');
    assert.equal(payload.crossChannelRuntime.channelNodeCount, 6);
    assert.equal(payload.crossChannelRuntime.nodeConfigEventCount, 6);
    assert.equal(payload.crossChannelRuntime.handoffEventCount, 2);
    assert.equal(payload.crossChannelRuntime.decisionEventCount, 1);
    assert.equal(payload.crossChannelRuntime.performanceEventCount, 2);
    assert.equal(payload.crossChannelRuntime.channelTotals.sms.conversions, 1);
    assert.equal(payload.crossChannelRuntime.runtimeHealth.channelNodeReady, true);
    assert.equal(payload.crossChannelRuntime.runtimeHealth.handoffReady, true);
    assert.equal(payload.crossChannelRuntime.runtimeHealth.decisionReady, true);
    assert.equal(payload.crossChannelRuntime.runtimeHealth.performanceReady, true);
    assert.ok(payload.crossChannelRuntime.evidenceContract.includes('normal_automation_builder_route_adoption'));

    await postForm(baseUrl, jar, `/automations/${automationId}/cross-channel/snapshot`, {});
    assert.equal(server.state.db.crossChannelJourneyRuntimeSnapshots.length, 1);
    const snapshot = buildCrossChannelJourneyRuntimeSnapshot(server.state, server.state.db.workspaces[0].id, automationId);
    assert.equal(snapshot.runtimeHealth.snapshotReady, true);
    assert.equal(snapshot.crossChannelAutomationCount, 1);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
