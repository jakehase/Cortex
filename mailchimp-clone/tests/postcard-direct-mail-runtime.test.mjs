import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { POSTCARD_DIRECT_MAIL_RUNTIME_CONTRACT, buildPostcardDirectMailRuntimeSnapshot } from '../packages/app/domain-current-product.mjs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('postcard direct-mail runtime records audience eligibility, creative proof, print handoff, delivery, snapshots, and API evidence', async () => {
  assert.equal(POSTCARD_DIRECT_MAIL_RUNTIME_CONTRACT.surfaceId, 'postcard_direct_mail_runtime_layer');
  assert.ok(POSTCARD_DIRECT_MAIL_RUNTIME_CONTRACT.controls.includes('postal_audience_eligibility_ledger'));

  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Postcard Runtime Owner',
      email: 'postcard-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Postcard Runtime Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const audienceId = server.state.db.audiences[0].id;
    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'Parker',
      lastName: 'Postal',
      email: 'parker-postal@example.com',
      tags: 'vip,postal'
    });
    await postForm(baseUrl, jar, '/contacts', {
      audienceId,
      firstName: 'Rowan',
      lastName: 'Mailbox',
      email: 'rowan-mailbox@example.com',
      tags: 'retained'
    });

    await postForm(baseUrl, jar, '/omnichannel', {
      name: 'VIP postcard winback',
      channel: 'postcard',
      audienceId,
      budget: '300',
      content: 'A glossy postcard offer for VIP customers.'
    });
    const program = server.state.db.channelPrograms.find((entry) => entry.name === 'VIP postcard winback');
    assert.ok(program);
    assert.equal(program.channel, 'postcard');
    assert.equal(server.state.db.postcardAddressValidationEvents.length, 1);
    assert.equal(server.state.db.postcardCreativeProofEvents.length, 1);
    assert.equal(server.state.db.postcardCreativeProofEvents[0].approvalStatus, 'approved');

    await postForm(baseUrl, jar, `/omnichannel/${program.id}/launch`, {});
    assert.equal(server.state.db.postcardProviderHandoffEvents.length, 1);
    assert.equal(server.state.db.postcardDeliveryTrackingEvents.length, 1);

    await postForm(baseUrl, jar, '/omnichannel/postcards/address', {
      programId: program.id,
      validCount: '2',
      invalidCount: '0',
      suppressedCount: '0'
    });
    await postForm(baseUrl, jar, '/omnichannel/postcards/proof', {
      programId: program.id,
      frontCopy: 'VIP front creative',
      backCopy: 'Redeem your VIP postcard offer.',
      approvalStatus: 'approved'
    });
    await postForm(baseUrl, jar, '/omnichannel/postcards/handoff', {
      programId: program.id,
      provider: 'mailclone_print_network',
      status: 'printed',
      recipientCount: '2'
    });
    await postForm(baseUrl, jar, '/omnichannel/postcards/delivery', {
      programId: program.id,
      mailedCount: '2',
      deliveredCount: '2',
      returnedCount: '0'
    });

    const runtimePage = await request(baseUrl, jar, '/omnichannel/postcard-runtime');
    const runtimeHtml = await runtimePage.text();
    assert.match(runtimeHtml, /Postcard runtime contract/);
    assert.match(runtimeHtml, /VIP postcard winback/);

    const apiRuntime = await request(baseUrl, jar, '/api/omnichannel/postcard-runtime');
    assert.equal(apiRuntime.status, 200);
    const payload = await apiRuntime.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.postcardRuntime.surfaceId, 'postcard_direct_mail_runtime_layer');
    assert.equal(payload.postcardRuntime.postcardProgramCount, 1);
    assert.equal(payload.postcardRuntime.livePostcardProgramCount, 1);
    assert.equal(payload.postcardRuntime.addressValidationEventCount >= 2, true);
    assert.equal(payload.postcardRuntime.creativeProofEventCount >= 2, true);
    assert.equal(payload.postcardRuntime.providerHandoffEventCount >= 2, true);
    assert.equal(payload.postcardRuntime.deliveryTrackingEventCount >= 2, true);
    assert.equal(payload.postcardRuntime.runtimeHealth.addressValidationReady, true);
    assert.equal(payload.postcardRuntime.runtimeHealth.creativeProofReady, true);
    assert.equal(payload.postcardRuntime.runtimeHealth.providerHandoffReady, true);
    assert.equal(payload.postcardRuntime.runtimeHealth.deliveryTrackingReady, true);
    assert.ok(payload.postcardRuntime.evidenceContract.includes('delivery_tracking_events_link_maildrops_to_campaign_program_metrics'));

    await postForm(baseUrl, jar, '/omnichannel/postcard-runtime/snapshot', {});
    assert.equal(server.state.db.postcardRuntimeSnapshots.length, 1);
    const snapshot = buildPostcardDirectMailRuntimeSnapshot(server.state, server.state.db.workspaces[0].id);
    assert.equal(snapshot.runtimeHealth.snapshotReady, true);
    assert.equal(snapshot.deliveredPostcardCount >= 2, true);
    assert.equal(snapshot.programs[0].postcardRuntime.lastDeliveryTrackingEventId, server.state.db.postcardDeliveryTrackingEvents[0].id);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
