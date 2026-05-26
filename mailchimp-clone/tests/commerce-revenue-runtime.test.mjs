import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';
import {
  COMMERCE_REVENUE_RUNTIME_CONTRACT,
  buildCommerceRevenueRuntimeSnapshot,
  recordProductRecommendationEvent,
  refreshCommerceCustomerProfiles
} from '../packages/app/domain-commerce-revenue.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('commerce revenue runtime builds customer profile, attribution, cart, recommendation, and snapshot state', () => {
  const state = {
    db: {
      commerceStores: [{ id: 'store_1', workspaceId: 'ws_1', name: 'Main store', provider: 'shopify', status: 'connected', syncStatus: 'synced', lastSyncedAt: '2026-05-12T00:00:00.000Z' }],
      commerceProducts: [{ id: 'prod_1', workspaceId: 'ws_1', storeId: 'store_1', sku: 'starter', name: 'Starter bundle', price: 39 }],
      commerceOrders: [
        { id: 'order_1', workspaceId: 'ws_1', storeId: 'store_1', orderNumber: '1001', customerEmail: 'buyer@example.com', total: 89, createdAt: '2026-05-12T00:00:00.000Z' },
        { id: 'order_2', workspaceId: 'ws_1', storeId: 'store_1', orderNumber: '1002', customerEmail: 'buyer@example.com', total: 238, createdAt: '2026-05-12T01:00:00.000Z' }
      ],
      revenueAttributions: [
        { id: 'rev_1', workspaceId: 'ws_1', storeId: 'store_1', orderId: 'order_1', campaignId: 'camp_1', revenue: 89, source: 'campaign', createdAt: '2026-05-12T00:00:00.000Z' },
        { id: 'rev_2', workspaceId: 'ws_1', storeId: 'store_1', orderId: 'order_2', campaignId: '', revenue: 238, source: 'integration', createdAt: '2026-05-12T01:00:00.000Z' }
      ],
      campaigns: [{ id: 'camp_1', workspaceId: 'ws_1', name: 'Revenue campaign', status: 'sent' }],
      commerceRuntimeSnapshots: [],
      commerceCustomerProfiles: [],
      abandonedCartEvents: [{ id: 'cart_1', workspaceId: 'ws_1', storeId: 'store_1', customerEmail: 'buyer@example.com', cartTotal: 129, status: 'open', capturedAt: '2026-05-12T02:00:00.000Z' }],
      productRecommendationEvents: [],
      events: [],
      auditEvents: []
    }
  };
  assert.equal(COMMERCE_REVENUE_RUNTIME_CONTRACT.surfaceId, 'commerce_revenue_attribution_runtime_layer');
  recordProductRecommendationEvent(state, { workspaceId: 'ws_1', storeId: 'store_1', source: 'test', recommendationType: 'best_sellers', products: [{ sku: 'starter', name: 'Starter bundle', price: 39 }] });
  const profiles = refreshCommerceCustomerProfiles(state, 'ws_1');
  assert.equal(profiles[0].totalRevenue, 327);
  assert.equal(profiles[0].lifecycleStage, 'high_value');
  const snapshot = buildCommerceRevenueRuntimeSnapshot(state, 'ws_1');
  assert.equal(snapshot.customerProfileCount, 1);
  assert.equal(snapshot.abandonedCartCount, 1);
  assert.equal(snapshot.recommendationEventCount, 1);
  assert.equal(snapshot.summary.attributedRevenue, 89);
  assert.ok(snapshot.evidenceContract.includes('commerce_runtime_api_evidence'));
});

test('commerce revenue runtime snapshot tolerates sparse strict-verifier fixture state', () => {
  const state = {
    workspace: { id: 'strict-workspace-1' },
    db: {
      commerceStores: [],
      commerceProducts: [],
      commerceOrders: []
    }
  };
  const snapshot = buildCommerceRevenueRuntimeSnapshot(state, 'strict-workspace-1');
  assert.equal(snapshot.workspaceId, 'strict-workspace-1');
  assert.equal(snapshot.summary.totalRevenue, 0);
  assert.equal(snapshot.revenueAttributionCount, 0);
  assert.deepEqual(state.db.revenueAttributions, []);
  assert.deepEqual(state.db.campaigns, []);
});

test('commerce revenue runtime routes persist store sync evidence, abandoned carts, recommendations, snapshots, and API output', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Commerce Runtime Admin',
      email: 'commerce-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Commerce Runtime Lab'
    }));
    const audienceId = server.state.db.audiences[0].id;
    const campaignCreate = await postForm(baseUrl, jar, '/campaigns', { name: 'Revenue Attribution Campaign' });
    const campaignId = campaignCreate.headers.get('location').match(/camp_[a-f0-9]+/)[0];
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/setup`, { name: 'Revenue Attribution Campaign', subject: 'Buy now', preheader: 'Offer', fromName: 'Commerce Runtime Admin', replyTo: 'reply@example.com' });
    await postForm(baseUrl, jar, `/campaigns/${campaignId}/recipients`, { audienceId, segmentId: '' });

    await postForm(baseUrl, jar, '/commerce/stores', { provider: 'shopify', name: 'Runtime Store', currency: 'USD' });
    const store = server.state.db.commerceStores[0];
    await postForm(baseUrl, jar, `/commerce/stores/${store.id}/sync`, {});
    assert.equal(server.state.db.commerceOrders.length, 2);
    assert.equal(server.state.db.revenueAttributions.length, 2);
    assert.equal(server.state.db.commerceCustomerProfiles.length, 2);
    assert.equal(server.state.db.productRecommendationEvents.some((entry) => entry.source === 'store_sync'), true);

    await postForm(baseUrl, jar, `/commerce/stores/${store.id}/abandoned-cart`, {
      customerEmail: 'cart@example.com',
      cartTotal: '129.50',
      productSkus: 'shopify-starter,shopify-pro',
      recoveryCampaignId: campaignId
    });
    await postForm(baseUrl, jar, `/commerce/stores/${store.id}/recommendations`, {
      customerEmail: 'buyer.one@example.com',
      recommendationType: 'next_best_product'
    });
    await postForm(baseUrl, jar, '/commerce/runtime/snapshot', {});
    assert.equal(server.state.db.abandonedCartEvents.length, 1);
    assert.equal(server.state.db.productRecommendationEvents.some((entry) => entry.source === 'merchant_route'), true);
    assert.equal(server.state.db.commerceRuntimeSnapshots.length, 1);

    const api = await request(baseUrl, jar, '/api/commerce/runtime');
    const payload = await api.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.commerceRuntime.surfaceId, 'commerce_revenue_attribution_runtime_layer');
    assert.equal(payload.commerceRuntime.customerProfileCount, 2);
    assert.equal(payload.commerceRuntime.abandonedCartCount, 1);
    assert.equal(payload.commerceRuntime.recommendationEventCount >= 2, true);
    assert.equal(payload.commerceRuntime.summary.orders, 2);

    const html = await (await request(baseUrl, jar, '/commerce')).text();
    assert.match(html, /Open commerce runtime API/);
    assert.match(html, /Customer profiles: 2/);
    assert.match(html, /Abandoned carts: 1/);
    assert.match(html, /Recommendations:/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
