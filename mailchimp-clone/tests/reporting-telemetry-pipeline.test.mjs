import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTelemetryPipelineSnapshot, recordAnalyticsEvent } from '../packages/app/analytics-events.mjs';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('reporting telemetry pipeline ingests events, records lineage, and builds rollup snapshots', () => {
  const state = {
    db: {
      analyticsEvents: [],
      analyticsPipelineRuns: [],
      telemetryLineageLedger: [],
      reportingTelemetrySnapshots: [],
      campaigns: [{ id: 'camp_1', workspaceId: 'ws_1', name: 'Spring Launch', status: 'sent', report: { history: [{ recipients: 100 }] } }],
      automations: [{ id: 'journey_1', workspaceId: 'ws_1', name: 'Welcome', status: 'live', report: { history: [{}] } }],
      automationRuns: [{ automationId: 'journey_1' }],
      websites: [{ id: 'web_1', workspaceId: 'ws_1', name: 'Storefront' }],
      commerceOrders: [{ id: 'ord_1', workspaceId: 'ws_1', total: 49, campaignId: 'camp_1' }]
    }
  };

  const open = recordAnalyticsEvent(state, { type: 'campaign_open', workspaceId: 'ws_1', campaignId: 'camp_1', recipientTotal: 100, count: 1 });
  const click = recordAnalyticsEvent(state, { type: 'campaign_click', workspaceId: 'ws_1', campaignId: 'camp_1', recipientTotal: 100, count: 1 });
  const website = recordAnalyticsEvent(state, { type: 'website_view', workspaceId: 'ws_1', websiteId: 'web_1', pageId: 'home' });

  assert.equal(open.source, 'campaign');
  assert.equal(click.lineage.campaignId, 'camp_1');
  assert.equal(website.source, 'website');
  assert.equal(state.db.analyticsPipelineRuns.length, 3);
  assert.equal(state.db.telemetryLineageLedger.length, 3);

  const snapshot = buildTelemetryPipelineSnapshot(state, 'ws_1');
  assert.equal(snapshot.eventCount, 3);
  assert.equal(snapshot.pipelineRunCount, 3);
  assert.equal(snapshot.lineageRowCount, 3);
  assert.equal(snapshot.sourceCounts.campaign, 2);
  assert.equal(snapshot.sourceCounts.website, 1);
  assert.equal(snapshot.eventTypeCounts.campaign_open, 1);
  assert.equal(snapshot.campaignRollups[0].openRate, 1);
  assert.equal(snapshot.campaignRollups[0].clickRate, 1);
  assert.equal(snapshot.websiteRollups[0].views, 1);
  assert.equal(snapshot.attribution.revenueTotal, 49);
  assert.equal(snapshot.freshness.status, 'telemetry_pipeline_active');
});

test('reports telemetry route refreshes durable rollup snapshot and preserves report overview', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Telemetry Admin',
      email: 'telemetry@example.com',
      password: 'secret123',
      workspaceName: 'Telemetry Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const workspaceId = server.state.db.workspaces[0].id;
    const campaignCreate = await postForm(baseUrl, jar, '/campaigns', { name: 'Telemetry Campaign' });
    const campaignId = campaignCreate.headers.get('location').match(/camp_[a-f0-9]+/)[0];
    recordAnalyticsEvent(server.state, { type: 'campaign_open', workspaceId, campaignId, recipientTotal: 50 });
    recordAnalyticsEvent(server.state, { type: 'campaign_click', workspaceId, campaignId, recipientTotal: 50 });
    recordAnalyticsEvent(server.state, { type: 'workspace_event', workspaceId, source: 'workspace', count: 3 });

    const reports = await request(baseUrl, jar, '/reports');
    const reportsHtml = await reports.text();
    assert.match(reportsHtml, /Telemetry pipeline/);
    assert.match(reportsHtml, /Open telemetry pipeline/);

    const refresh = await postForm(baseUrl, jar, '/reports/telemetry/refresh', {});
    assert.equal(refresh.headers.get('location'), '/reports/telemetry');
    assert.equal(server.state.db.reportingTelemetrySnapshots.length, 1);
    assert.equal(server.state.db.reportingTelemetrySnapshots[0].campaignRollups[0].eventCount, 2);

    const telemetry = await request(baseUrl, jar, '/reports/telemetry');
    const telemetryHtml = await telemetry.text();
    assert.match(telemetryHtml, /Reporting telemetry pipeline/);
    assert.match(telemetryHtml, /Pipeline freshness/);
    assert.match(telemetryHtml, /Source counts/);
    assert.match(telemetryHtml, /Telemetry Campaign/);
    assert.match(telemetryHtml, /Lineage preview/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
