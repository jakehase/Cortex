import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { SOCIAL_PUBLISHING_RUNTIME_CONTRACT, buildSocialPublishingRuntimeSnapshot } from '../packages/app/domain-current-product.mjs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('social publishing runtime records approval, scheduling, provider handoff, engagement, snapshots, and API evidence', async () => {
  assert.equal(SOCIAL_PUBLISHING_RUNTIME_CONTRACT.surfaceId, 'social_publishing_native_runtime_layer');
  assert.ok(SOCIAL_PUBLISHING_RUNTIME_CONTRACT.controls.includes('social_provider_handoff_history'));

  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Social Runtime Admin',
      email: 'social-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Social Runtime Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    await postForm(baseUrl, jar, '/omnichannel', {
      name: 'Launch social publisher runtime',
      channel: 'social',
      budget: '400',
      content: 'Launch post with proof and a clear CTA.',
      consentMode: 'brand_safe'
    });
    const program = server.state.db.channelPrograms.find((entry) => entry.name === 'Launch social publisher runtime');
    assert.ok(program);
    assert.equal(server.state.db.socialApprovalEvents.length, 1);
    assert.equal(server.state.db.socialApprovalEvents[0].status, 'pending_review');

    await postForm(baseUrl, jar, `/omnichannel/${program.id}/launch`, {});
    await postForm(baseUrl, jar, '/omnichannel/social/approval', {
      programId: program.id,
      status: 'approved',
      comment: 'Approved after brand review'
    });
    await postForm(baseUrl, jar, '/omnichannel/social/schedule', {
      programId: program.id,
      network: 'linkedin',
      postType: 'feed',
      scheduledFor: '2026-05-12T15:00:00.000Z'
    });
    await postForm(baseUrl, jar, '/omnichannel/social/provider-handoff', {
      programId: program.id,
      provider: 'mailclone_social',
      status: 'published',
      externalPostId: 'linkedin_123'
    });
    await postForm(baseUrl, jar, '/omnichannel/social/engagement', {
      programId: program.id,
      network: 'linkedin',
      impressions: '275',
      engagements: '44',
      clicks: '18',
      conversions: '4'
    });
    await postForm(baseUrl, jar, '/omnichannel/social-runtime/snapshot', {});

    const runtimePage = await request(baseUrl, jar, '/omnichannel/social-runtime');
    const runtimeHtml = await runtimePage.text();
    assert.match(runtimeHtml, /Social runtime contract/);
    assert.match(runtimeHtml, /Launch social publisher runtime/);

    const apiRuntime = await request(baseUrl, jar, '/api/omnichannel/social-runtime');
    const payload = await apiRuntime.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.socialRuntime.socialProgramCount, 1);
    assert.equal(payload.socialRuntime.liveSocialProgramCount, 1);
    assert.equal(payload.socialRuntime.approvalEventCount >= 3, true);
    assert.equal(payload.socialRuntime.scheduledPostCount >= 2, true);
    assert.equal(payload.socialRuntime.providerHandoffCount >= 2, true);
    assert.equal(payload.socialRuntime.engagementEventCount >= 2, true);
    assert.equal(payload.socialRuntime.totalImpressions >= 275, true);
    assert.ok(payload.socialRuntime.evidenceContract.includes('provider_handoff_status_history'));

    const snapshot = buildSocialPublishingRuntimeSnapshot(server.state, server.state.db.workspaces[0].id);
    assert.equal(snapshot.programs[0].socialRuntime.lastEngagementEventId, server.state.db.socialEngagementEvents[0].id);
    assert.equal(server.state.db.socialRuntimeSnapshots.length, 1);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
