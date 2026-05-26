import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { SMS_MARKETING_RUNTIME_CONTRACT, buildSmsMarketingRuntimeSnapshot } from '../packages/app/domain-current-product.mjs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('SMS marketing runtime records consent, compliance, delivery, link tracking, snapshots, and API evidence', async () => {
  assert.equal(SMS_MARKETING_RUNTIME_CONTRACT.surfaceId, 'sms_marketing_native_runtime_layer');
  assert.ok(SMS_MARKETING_RUNTIME_CONTRACT.controls.includes('sms_consent_receipt_ledger'));

  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'SMS Runtime Admin',
      email: 'sms-runtime@example.com',
      password: 'secret123',
      workspaceName: 'SMS Runtime Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    await postForm(baseUrl, jar, '/omnichannel', {
      name: 'VIP SMS runtime follow-up',
      channel: 'sms',
      budget: '250',
      content: 'VIP early access starts now.',
      consentMode: 'respect_preferences'
    });
    const program = server.state.db.channelPrograms.find((entry) => entry.name === 'VIP SMS runtime follow-up');
    assert.ok(program);
    assert.equal(server.state.db.smsComplianceEvents.length, 1);

    await postForm(baseUrl, jar, `/omnichannel/${program.id}/launch`, {});
    await postForm(baseUrl, jar, '/omnichannel/sms/consent', {
      programId: program.id,
      phone: '+15551234567',
      consentStatus: 'opted_in',
      disclosureVersion: 'sms_disclosure_v2'
    });
    await postForm(baseUrl, jar, '/omnichannel/sms/compliance', {
      programId: program.id,
      policy: 'quiet_hours',
      result: 'passed',
      checkedAtLocal: '10:30'
    });
    await postForm(baseUrl, jar, '/omnichannel/sms/delivery', {
      programId: program.id,
      provider: 'mailclone_sms',
      carrier: 'carrier_a',
      recipientCount: '3',
      status: 'delivered'
    });
    await postForm(baseUrl, jar, '/omnichannel/sms/link', {
      programId: program.id,
      url: 'https://example.test/sms-offer',
      clickCount: '2'
    });
    await postForm(baseUrl, jar, '/omnichannel/sms-runtime/snapshot', {});

    const runtimePage = await request(baseUrl, jar, '/omnichannel/sms-runtime');
    const runtimeHtml = await runtimePage.text();
    assert.match(runtimeHtml, /SMS runtime contract/);
    assert.match(runtimeHtml, /VIP SMS runtime follow-up/);

    const apiRuntime = await request(baseUrl, jar, '/api/omnichannel/sms-runtime');
    const payload = await apiRuntime.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.smsRuntime.smsProgramCount, 1);
    assert.equal(payload.smsRuntime.liveSmsProgramCount, 1);
    assert.equal(payload.smsRuntime.consentEventCount, 1);
    assert.equal(payload.smsRuntime.complianceEventCount >= 3, true);
    assert.equal(payload.smsRuntime.deliveryAttemptCount >= 2, true);
    assert.equal(payload.smsRuntime.linkTrackingEventCount, 1);
    assert.equal(payload.smsRuntime.clickCount >= 2, true);
    assert.ok(payload.smsRuntime.evidenceContract.includes('carrier_delivery_attempt_history'));

    const snapshot = buildSmsMarketingRuntimeSnapshot(server.state, server.state.db.workspaces[0].id);
    assert.equal(snapshot.programs[0].smsRuntime.lastLinkTrackingEventId, server.state.db.smsLinkTrackingEvents[0].id);
    assert.equal(server.state.db.smsRuntimeSnapshots.length, 1);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
