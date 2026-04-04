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

test('Wave 2 integrations marketplace: install connectors, run syncs, and expose API realism', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Integration Admin',
      email: 'integration@example.com',
      password: 'secret123',
      workspaceName: 'Integration Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    await postForm(baseUrl, jar, '/integrations/install', { appId: 'shopify' });
    await postForm(baseUrl, jar, '/integrations/install', { appId: 'slack' });
    const installationId = server.state.db.integrationInstallations.find((entry) => entry.appId === 'shopify').id;
    await postForm(baseUrl, jar, `/integrations/${installationId}/sync`, {});

    const integrationsPage = await request(baseUrl, jar, '/integrations');
    const integrationsHtml = await integrationsPage.text();
    assert.match(integrationsHtml, /Shopify/);
    assert.match(integrationsHtml, /Slack/);
    assert.match(integrationsHtml, /sync completed|succeeded|installed/);

    const apiKey = (await (await request(baseUrl, jar, '/workspaces')).text()).match(/key_[a-f0-9]+/)[0];
    const integrationsApi = await request(baseUrl, null, '/api/integrations', {
      headers: { authorization: `Bearer ${apiKey}` }
    });
    const integrationsPayload = await integrationsApi.json();
    assert.equal(integrationsPayload.ok, true);
    assert.equal(integrationsPayload.integrations.length, 2);

    const syncApi = await request(baseUrl, null, `/api/integrations/${installationId}/sync`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` }
    });
    const syncPayload = await syncApi.json();
    assert.equal(syncPayload.ok, true);
    assert.ok(syncPayload.result.revenue.stores >= 1);
    assert.ok(server.state.db.integrationSyncRuns.length >= 2);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
