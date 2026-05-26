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

test('integration provider runtime persists provider accounts, auth sessions, cursors, request lineage, webhook verification, and app adoption', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Provider Runtime Admin',
      email: 'provider-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Provider Runtime Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    await postForm(baseUrl, jar, '/integrations/install', { appId: 'shopify' });
    const installation = server.state.db.integrationInstallations.find((entry) => entry.appId === 'shopify');
    assert.ok(installation.providerAccount);
    assert.equal(installation.providerAccount.status, 'authorization_required');
    assert.ok(installation.providerAccount.evidenceContract.includes('provider_account_identity'));

    await postForm(baseUrl, jar, `/integrations/${installation.id}/auth`, {
      accountLabel: 'Main Shopify storefront',
      externalAccountId: 'shop-main-001',
      authStatus: 'connected'
    });
    await postForm(baseUrl, jar, `/integrations/${installation.id}/config`, {
      syncAudienceId: server.state.db.audiences[0].id,
      syncOrders: 'on',
      syncProducts: 'on',
      syncLeads: 'on'
    });
    await postForm(baseUrl, jar, `/integrations/${installation.id}/mapping`, {
      email: 'customer.email',
      phone: 'customer.phone',
      tags: 'customer.tags',
      lifecycleStage: 'customer.lifecycle_stage',
      consent: 'customer.marketing_consent'
    });
    await postForm(baseUrl, jar, `/integrations/${installation.id}/sync`, {});
    await postForm(baseUrl, jar, `/integrations/${installation.id}/webhooks/test`, {
      eventType: 'orders/create',
      externalObjectId: 'order_1001'
    });

    const updated = server.state.db.integrationInstallations.find((entry) => entry.id === installation.id);
    assert.equal(updated.providerAccount.externalAccountId, 'shop-main-001');
    assert.equal(updated.providerAccount.status, 'connected');
    assert.equal(updated.providerCursor.installationId, installation.id);
    assert.match(updated.providerCursor.cursor, /updated_at_since:/);
    assert.equal(server.state.db.integrationProviderAccounts.length, 1);
    assert.equal(server.state.db.integrationProviderAuthSessions.length >= 1, true);
    assert.equal(server.state.db.integrationProviderCursors.length, 1);
    assert.equal(server.state.db.integrationProviderRequests.length, 1);
    assert.equal(server.state.db.integrationProviderWebhookEvents.length, 1);
    assert.equal(server.state.db.integrationProviderWebhookEvents[0].signatureStatus, 'verified');

    const syncRun = server.state.db.integrationSyncRuns[0];
    assert.equal(syncRun.providerStatus, 'synced');
    assert.equal(syncRun.providerAccountId, server.state.db.integrationProviderAccounts[0].id);
    assert.equal(syncRun.providerRequestId, server.state.db.integrationProviderRequests[0].id);
    assert.ok(syncRun.requestLineage.some((entry) => entry.objectType === 'orders'));

    const marketplace = await request(baseUrl, jar, '/integrations');
    const marketplaceHtml = await marketplace.text();
    assert.match(marketplaceHtml, /Provider accounts/);
    assert.match(marketplaceHtml, /Provider requests/);
    assert.match(marketplaceHtml, /shop-main-001/);

    const detail = await request(baseUrl, jar, `/integrations/${installation.id}`);
    const detailHtml = await detail.text();
    assert.match(detailHtml, /Provider account runtime/);
    assert.match(detailHtml, /Provider cursor/);
    assert.match(detailHtml, /Webhook verification/);
    assert.match(detailHtml, /orders\/create/);

    const api = await request(baseUrl, jar, `/api/integrations/${installation.id}`);
    assert.equal(api.status, 200);
    const payload = await api.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.summary.providerAccount.externalAccountId, 'shop-main-001');
    assert.equal(payload.summary.providerCursor.installationId, installation.id);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
