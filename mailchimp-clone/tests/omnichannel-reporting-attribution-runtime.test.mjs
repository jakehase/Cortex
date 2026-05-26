import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { OMNICHANNEL_REPORTING_ATTRIBUTION_RUNTIME_CONTRACT, buildOmnichannelReportingAttributionRuntimeSnapshot } from '../packages/app/domain-current-product.mjs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('omnichannel reporting attribution runtime records channel mix, objective rollups, touchpoint attribution, snapshots, and API evidence', async () => {
  assert.equal(OMNICHANNEL_REPORTING_ATTRIBUTION_RUNTIME_CONTRACT.surfaceId, 'omnichannel_reporting_attribution_runtime_layer');
  assert.ok(OMNICHANNEL_REPORTING_ATTRIBUTION_RUNTIME_CONTRACT.controls.includes('touchpoint_attribution_events'));

  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Omnichannel Reporting Owner',
      email: 'omnichannel-reporting@example.com',
      password: 'secret123',
      workspaceName: 'Omnichannel Reporting Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const campaignCreate = await postForm(baseUrl, jar, '/campaigns', { name: 'Attribution Launch Campaign' });
    const campaignId = campaignCreate.headers.get('location').match(/camp_[a-f0-9]+/)[0];

    for (const [channel, budget] of [['sms', '150'], ['social', '300'], ['ads', '500'], ['postcard', '250']]) {
      await postForm(baseUrl, jar, '/omnichannel', {
        name: `${channel} attribution program`,
        channel,
        campaignId,
        budget,
        content: `${channel} attribution content`
      });
      const program = server.state.db.channelPrograms.find((entry) => entry.name === `${channel} attribution program`);
      await postForm(baseUrl, jar, `/omnichannel/${program.id}/launch`, {});
    }
    const socialProgram = server.state.db.channelPrograms.find((entry) => entry.channel === 'social');
    const adsProgram = server.state.db.channelPrograms.find((entry) => entry.channel === 'ads');

    await postForm(baseUrl, jar, '/reports/omnichannel/channel-mix', { campaignId, objective: 'launch_revenue' });
    await postForm(baseUrl, jar, '/reports/omnichannel/objective-rollup', {
      campaignId,
      objective: 'revenue',
      channel: 'all',
      touchpoints: '11',
      conversions: '3',
      revenue: '297',
      attributionModel: 'last_non_direct_touch'
    });
    await postForm(baseUrl, jar, '/reports/omnichannel/attribution', {
      campaignId,
      programId: socialProgram.id,
      channel: 'social',
      contactId: 'contact-social-1',
      touchpointType: 'click',
      conversionId: 'conv-1',
      revenue: '129',
      attributionWeight: '0.6'
    });
    await postForm(baseUrl, jar, '/reports/omnichannel/attribution', {
      campaignId,
      programId: adsProgram.id,
      channel: 'ads',
      contactId: 'contact-ads-1',
      touchpointType: 'view_through',
      conversionId: 'conv-2',
      revenue: '168',
      attributionWeight: '0.4'
    });

    const runtimePage = await request(baseUrl, jar, '/reports/omnichannel/runtime');
    const runtimeHtml = await runtimePage.text();
    assert.match(runtimeHtml, /Omnichannel reporting attribution runtime/);
    assert.match(runtimeHtml, /Attributed revenue: 297/);

    const apiRuntime = await request(baseUrl, jar, '/api/reports/omnichannel/runtime');
    assert.equal(apiRuntime.status, 200);
    const payload = await apiRuntime.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.omnichannelReportingRuntime.surfaceId, 'omnichannel_reporting_attribution_runtime_layer');
    assert.equal(payload.omnichannelReportingRuntime.programCount, 4);
    assert.equal(payload.omnichannelReportingRuntime.liveProgramCount, 4);
    assert.equal(payload.omnichannelReportingRuntime.channelMixSnapshotCount, 1);
    assert.equal(payload.omnichannelReportingRuntime.objectiveRollupCount, 1);
    assert.equal(payload.omnichannelReportingRuntime.attributionEventCount, 2);
    assert.equal(payload.omnichannelReportingRuntime.attributedRevenue, 297);
    assert.equal(payload.omnichannelReportingRuntime.attributedConversions, 2);
    assert.equal(payload.omnichannelReportingRuntime.revenueByChannel.social, 129);
    assert.equal(payload.omnichannelReportingRuntime.revenueByChannel.ads, 168);
    assert.equal(payload.omnichannelReportingRuntime.runtimeHealth.channelMixReady, true);
    assert.equal(payload.omnichannelReportingRuntime.runtimeHealth.objectiveRollupReady, true);
    assert.equal(payload.omnichannelReportingRuntime.runtimeHealth.attributionReady, true);
    assert.ok(payload.omnichannelReportingRuntime.evidenceContract.includes('touchpoint_attribution_events_capture_channel_and_revenue'));

    await postForm(baseUrl, jar, '/reports/omnichannel/runtime/snapshot', {});
    assert.equal(server.state.db.omnichannelReportingRuntimeSnapshots.length, 1);
    const snapshot = buildOmnichannelReportingAttributionRuntimeSnapshot(server.state, server.state.db.workspaces[0].id);
    assert.equal(snapshot.runtimeHealth.snapshotReady, true);
    assert.equal(snapshot.channelMix.social.programs, 1);
    assert.equal(snapshot.channelMix.ads.programs, 1);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
