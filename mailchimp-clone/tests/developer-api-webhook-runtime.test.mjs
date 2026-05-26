import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { buildDeveloperApiRuntimeSnapshot } from '../packages/app/domain-core.mjs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('developer API/webhook runtime records scoped keys, request audit, signed delivery replay, subscription lifecycle, snapshots, and API evidence', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Developer Runtime Admin',
      email: 'developer-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Developer Runtime Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const keysPage = await request(baseUrl, jar, '/developer/api-keys');
    assert.match(await keysPage.text(), /Scoped API key runtime/);

    await postForm(baseUrl, jar, '/developer/api-keys', {
      label: 'Warehouse Sync App',
      scopes: 'contacts:read,campaigns:write,webhooks:replay',
      environment: 'production',
      expiresAt: '2026-12-31T00:00:00.000Z'
    });
    const scopedKey = server.state.db.apiKeys.find((entry) => entry.label === 'Warehouse Sync App');
    assert.ok(scopedKey);
    assert.deepEqual(scopedKey.scopes, ['contacts:read', 'campaigns:write', 'webhooks:replay']);
    assert.equal(scopedKey.runtimeContract, 'developer_webhooks_api_runtime_layer');

    const apiMe = await request(baseUrl, null, '/api/me', { headers: { authorization: `Bearer ${scopedKey.token}` } });
    assert.equal(apiMe.status, 200);
    assert.equal(server.state.db.developerApiRequestAudits.length, 1);
    assert.match(server.state.db.developerApiRequestAudits[0].path, /\/api\/me/);
    assert.equal(scopedKey.lastUsedAt, server.state.db.developerApiRequestAudits[0].createdAt);

    await postForm(baseUrl, jar, '/developer/webhooks', {
      targetUrl: 'https://example.test/runtime-webhook',
      events: 'contact.created,campaign.sent'
    });
    const hook = server.state.db.webhooks.find((entry) => entry.targetUrl === 'https://example.test/runtime-webhook');
    assert.ok(hook);
    assert.equal(hook.status, 'active');
    assert.ok(hook.signingSecret.startsWith('whsec_'));
    assert.ok(server.state.db.webhookSubscriptionEvents.some((entry) => entry.action === 'subscription_created'));

    await postForm(baseUrl, jar, `/developer/webhooks/${hook.id}/deliver`, {
      eventType: 'contact.created',
      payload: '{"email":"new@example.com"}'
    });
    const delivery = server.state.db.webhookDeliveries.find((entry) => entry.webhookId === hook.id && entry.eventType === 'contact.created');
    assert.ok(delivery);
    assert.equal(delivery.signed, true);
    assert.ok(delivery.headers['X-Mailclone-Signature'].startsWith('sha256='));

    await postForm(baseUrl, jar, `/developer/webhooks/deliveries/${delivery.id}/replay`, {});
    const replay = server.state.db.webhookDeliveries.find((entry) => entry.replayOfDeliveryId === delivery.id);
    assert.ok(replay);
    assert.equal(replay.status, 'replayed');
    assert.equal(replay.signed, true);

    await postForm(baseUrl, jar, `/developer/webhooks/${hook.id}/pause`, {});
    assert.equal(hook.status, 'paused');
    await postForm(baseUrl, jar, `/developer/webhooks/${hook.id}/resume`, {});
    assert.equal(hook.status, 'active');

    const webhooksPage = await request(baseUrl, jar, '/developer/webhooks');
    const webhooksHtml = await webhooksPage.text();
    assert.match(webhooksHtml, /Webhook subscription lifecycle/);
    assert.match(webhooksHtml, /Signed delivery history and replay/);
    assert.match(webhooksHtml, /Replay/);

    const runtimeApi = await request(baseUrl, null, '/api/developer/runtime', { headers: { authorization: `Bearer ${scopedKey.token}` } });
    assert.equal(runtimeApi.status, 200);
    const runtimePayload = await runtimeApi.json();
    assert.equal(runtimePayload.ok, true);
    assert.equal(runtimePayload.developerRuntime.surfaceId, 'developer_webhooks_api_runtime_layer');
    assert.equal(runtimePayload.developerRuntime.runtimeHealth.scopedKeysReady, true);
    assert.equal(runtimePayload.developerRuntime.runtimeHealth.requestAuditReady, true);
    assert.equal(runtimePayload.developerRuntime.runtimeHealth.signedDeliveryReady, true);
    assert.equal(runtimePayload.developerRuntime.runtimeHealth.replayReady, true);

    const snapshotPage = await request(baseUrl, jar, '/developer/runtime/snapshot');
    assert.equal(snapshotPage.status, 200);
    assert.equal(server.state.db.developerRuntimeSnapshots.length, 1);
    assert.match(await snapshotPage.text(), /Developer API\/webhook runtime contract/);

    const snapshot = buildDeveloperApiRuntimeSnapshot(server.state, server.state.db.workspaces[0].id);
    assert.equal(snapshot.apiKeys.scopedKeyCount >= 1, true);
    assert.equal(snapshot.requestAudit.count >= 2, true);
    assert.equal(snapshot.webhookSubscriptions.lifecycleEventCount >= 4, true);
    assert.equal(snapshot.deliveries.replayCount >= 1, true);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
