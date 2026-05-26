import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ADS_RETARGETING_RUNTIME_CONTRACT, buildAdsRetargetingRuntimeSnapshot } from '../packages/app/domain-current-product.mjs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('ads retargeting runtime records audiences, budget pacing, provider sync, attribution, snapshots, and API evidence', async () => {
  assert.equal(ADS_RETARGETING_RUNTIME_CONTRACT.surfaceId, 'ads_retargeting_runtime_layer');
  assert.ok(ADS_RETARGETING_RUNTIME_CONTRACT.controls.includes('ads_provider_sync_history'));

  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Ads Runtime Admin',
      email: 'ads-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Ads Runtime Lab'
    });
    await followRedirect(baseUrl, jar, signup);
    const audienceId = server.state.db.audiences[0].id;
    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'Avery',
      lastName: 'Clicker',
      email: 'avery@example.com',
      tags: 'clicked,last30'
    });

    await postForm(baseUrl, jar, '/omnichannel', {
      name: 'Retarget launch visitors',
      channel: 'ads',
      audienceId,
      budget: '700',
      content: 'Retarget launch page visitors with the best offer.',
      consentMode: 'ad_preferences'
    });
    const program = server.state.db.channelPrograms.find((entry) => entry.name === 'Retarget launch visitors');
    assert.ok(program);
    assert.equal(server.state.db.adsRetargetingAudiences.length, 1);

    await postForm(baseUrl, jar, `/omnichannel/${program.id}/launch`, {});
    await postForm(baseUrl, jar, '/omnichannel/ads/audience', {
      programId: program.id,
      segmentRule: 'campaign_clickers_14d AND not_recent_buyers',
      memberCount: '33'
    });
    await postForm(baseUrl, jar, '/omnichannel/ads/budget', {
      programId: program.id,
      dailyBudget: '50',
      spendToDate: '175',
      pacingStatus: 'on_track'
    });
    await postForm(baseUrl, jar, '/omnichannel/ads/provider-sync', {
      programId: program.id,
      provider: 'mailclone_ads',
      status: 'synced',
      externalCampaignId: 'ads_123',
      syncedObjects: 'audience,campaign,creative,budget'
    });
    await postForm(baseUrl, jar, '/omnichannel/ads/conversion', {
      programId: program.id,
      conversions: '5',
      revenue: '245',
      attributionWindowDays: '14'
    });
    await postForm(baseUrl, jar, '/omnichannel/ads-runtime/snapshot', {});

    const runtimePage = await request(baseUrl, jar, '/omnichannel/ads-runtime');
    const runtimeHtml = await runtimePage.text();
    assert.match(runtimeHtml, /Ads runtime contract/);
    assert.match(runtimeHtml, /Retarget launch visitors/);

    const apiRuntime = await request(baseUrl, jar, '/api/omnichannel/ads-runtime');
    const payload = await apiRuntime.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.adsRuntime.adsProgramCount, 1);
    assert.equal(payload.adsRuntime.liveAdsProgramCount, 1);
    assert.equal(payload.adsRuntime.retargetingAudienceCount >= 2, true);
    assert.equal(payload.adsRuntime.budgetPacingEventCount >= 2, true);
    assert.equal(payload.adsRuntime.providerSyncEventCount >= 2, true);
    assert.equal(payload.adsRuntime.conversionAttributionEventCount >= 2, true);
    assert.equal(payload.adsRuntime.attributedConversions >= 5, true);
    assert.ok(payload.adsRuntime.evidenceContract.includes('provider_sync_status_history'));

    const snapshot = buildAdsRetargetingRuntimeSnapshot(server.state, server.state.db.workspaces[0].id);
    assert.equal(snapshot.programs[0].adsRuntime.lastConversionAttributionEventId, server.state.db.adsConversionAttributionEvents[0].id);
    assert.equal(server.state.db.adsRuntimeSnapshots.length, 1);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
