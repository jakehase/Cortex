import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { SOCIAL_CALENDAR_COORDINATION_RUNTIME_CONTRACT, buildSocialCalendarCoordinationRuntimeSnapshot } from '../packages/app/domain-current-product.mjs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('social calendar coordination runtime records campaign links, calendar placements, timeline events, snapshots, and API evidence', async () => {
  assert.equal(SOCIAL_CALENDAR_COORDINATION_RUNTIME_CONTRACT.surfaceId, 'social_calendar_coordination_runtime_layer');
  assert.ok(SOCIAL_CALENDAR_COORDINATION_RUNTIME_CONTRACT.controls.includes('social_calendar_placement_ledger'));

  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Social Calendar Owner',
      email: 'social-calendar@example.com',
      password: 'secret123',
      workspaceName: 'Social Calendar Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const campaignCreate = await postForm(baseUrl, jar, '/campaigns', { name: 'Calendar Launch Campaign' });
    const campaignId = campaignCreate.headers.get('location').match(/camp_[a-f0-9]+/)[0];

    await postForm(baseUrl, jar, '/omnichannel', {
      name: 'Calendar launch social plan',
      channel: 'social',
      campaignId,
      budget: '450',
      content: 'Social calendar launch post coordinated with the email campaign.'
    });
    const program = server.state.db.channelPrograms.find((entry) => entry.name === 'Calendar launch social plan');
    assert.ok(program);
    assert.equal(program.campaignId, campaignId);

    await postForm(baseUrl, jar, '/omnichannel/social-calendar/placement', {
      programId: program.id,
      campaignId,
      network: 'linkedin',
      calendarDate: '2026-05-15',
      slotLabel: 'launch_morning',
      status: 'scheduled',
      objective: 'launch_awareness'
    });
    await postForm(baseUrl, jar, '/omnichannel/social-calendar/coordination', {
      programId: program.id,
      campaignId,
      coordinationMode: 'email_launch_support',
      launchWindow: 'same_day',
      dependencyStatus: 'ready'
    });
    await postForm(baseUrl, jar, '/omnichannel/social-calendar/timeline', {
      programId: program.id,
      campaignId,
      channel: 'social',
      eventType: 'scheduled_publish',
      sequenceOrder: '2',
      status: 'scheduled'
    });

    const runtimePage = await request(baseUrl, jar, '/omnichannel/social-calendar');
    const runtimeHtml = await runtimePage.text();
    assert.match(runtimeHtml, /Social calendar contract/);
    assert.match(runtimeHtml, /linkedin/);

    const apiRuntime = await request(baseUrl, jar, '/api/omnichannel/social-calendar-runtime');
    assert.equal(apiRuntime.status, 200);
    const payload = await apiRuntime.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.socialCalendarRuntime.surfaceId, 'social_calendar_coordination_runtime_layer');
    assert.equal(payload.socialCalendarRuntime.socialProgramCount, 1);
    assert.equal(payload.socialCalendarRuntime.calendarPlacementCount, 1);
    assert.equal(payload.socialCalendarRuntime.campaignCoordinationEventCount, 1);
    assert.equal(payload.socialCalendarRuntime.timelineEventCount, 1);
    assert.equal(payload.socialCalendarRuntime.coordinatedCampaignCount, 1);
    assert.equal(payload.socialCalendarRuntime.runtimeHealth.calendarPlacementReady, true);
    assert.equal(payload.socialCalendarRuntime.runtimeHealth.campaignCoordinationReady, true);
    assert.equal(payload.socialCalendarRuntime.runtimeHealth.timelineReady, true);
    assert.ok(payload.socialCalendarRuntime.evidenceContract.includes('timeline_events_show_cross_channel_sequence'));

    await postForm(baseUrl, jar, '/omnichannel/social-calendar/snapshot', {});
    assert.equal(server.state.db.socialCalendarRuntimeSnapshots.length, 1);
    const snapshot = buildSocialCalendarCoordinationRuntimeSnapshot(server.state, server.state.db.workspaces[0].id);
    assert.equal(snapshot.runtimeHealth.snapshotReady, true);
    assert.equal(snapshot.programs[0].socialCalendarRuntime.lastTimelineEventId, server.state.db.socialTimelineEvents[0].id);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
