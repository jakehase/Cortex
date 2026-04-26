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

test('Wave 2 commerce revenue: connect stores, sync catalog and orders, and expose revenue attribution', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Revenue Admin',
      email: 'revenue@example.com',
      password: 'secret123',
      workspaceName: 'Revenue Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    const draft = await postForm(baseUrl, jar, '/campaigns', { name: 'Revenue launcher' });
    assert.match(draft.headers.get('location'), /camp_[a-f0-9]+/);

    await postForm(baseUrl, jar, '/commerce/stores', {
      provider: 'shopify',
      name: 'Main revenue store',
      currency: 'USD'
    });
    const storeId = server.state.db.commerceStores[0].id;
    await postForm(baseUrl, jar, `/commerce/stores/${storeId}/sync`, {});

    const commercePage = await request(baseUrl, jar, '/commerce');
    const commerceHtml = await commercePage.text();
    assert.match(commerceHtml, /Main revenue store/);
    assert.match(commerceHtml, /Starter bundle/);
    assert.match(commerceHtml, /Revenue attribution rows/);

    const apiKey = (await (await request(baseUrl, jar, '/workspaces')).text()).match(/key_[a-f0-9]+/)[0];
    const revenueApi = await request(baseUrl, null, '/api/commerce/revenue', {
      headers: { authorization: `Bearer ${apiKey}` }
    });
    const payload = await revenueApi.json();
    assert.equal(payload.ok, true);
    assert.ok(payload.revenue.totalRevenue > 0);
    assert.ok(payload.revenue.attributedRevenue > 0);
    assert.ok(payload.revenue.averageOrderValue > 0);
    assert.equal(payload.revenue.sourceBreakdown[0].source, 'campaign');
    assert.equal(payload.revenue.topCampaigns[0].campaignId, server.state.db.campaigns[0].id);
    assert.equal(payload.revenue.recentActivity.length >= 2, true);
    assert.ok(server.state.db.commerceOrders.length >= 2);
    assert.ok(server.state.db.revenueAttributions.length >= 2);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
