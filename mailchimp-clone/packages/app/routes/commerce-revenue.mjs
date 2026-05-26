import { page } from '../view.mjs';
import { json, readBody, redirect, text } from '../utils.mjs';
import { COMMERCE_PROVIDERS, buildCommerceRevenueRuntimeSnapshot, connectStore, persistCommerceRevenueRuntimeSnapshot, recordAbandonedCartEvent, recordProductRecommendationEvent, revenueSummary, syncCommerceStore, workspaceRevenueRows, workspaceStores } from '../domain-commerce-revenue.mjs';
import { persistState } from '../storage.mjs';

export function registerCommerceRevenueRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/commerce', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const stores = workspaceStores(state, actor.workspace.id);
    const summary = revenueSummary(state, actor.workspace.id);
    const products = state.db.commerceProducts.filter((entry) => entry.workspaceId === actor.workspace.id);
    const orders = state.db.commerceOrders.filter((entry) => entry.workspaceId === actor.workspace.id);
    const revenue = workspaceRevenueRows(state, actor.workspace.id);
    const runtime = buildCommerceRevenueRuntimeSnapshot(state, actor.workspace.id);
    text(res, 200, page('Commerce revenue attribution', actor, `<div class="grid"><div class="card"><h3>Connect revenue source</h3><form method="post" action="/commerce/stores"><select name="provider">${COMMERCE_PROVIDERS.map((provider) => `<option value="${provider.id}">${provider.name}</option>`).join('')}</select><input name="name" placeholder="Main store"><input name="currency" value="USD"><button>Connect store</button></form></div><div class="card"><h3>Revenue summary</h3><ul><li>Stores: ${summary.stores}</li><li>Products: ${summary.products}</li><li>Orders: ${summary.orders}</li><li>Total revenue: $${summary.totalRevenue}</li><li>Attributed revenue: $${summary.attributedRevenue}</li><li>Customer profiles: ${runtime.customerProfileCount}</li><li>Abandoned carts: ${runtime.abandonedCartCount}</li><li>Recommendations: ${runtime.recommendationEventCount}</li></ul><form method="post" action="/commerce/runtime/snapshot"><button>Capture commerce runtime snapshot</button></form><p><a href="/api/commerce/runtime">Open commerce runtime API</a></p></div></div><div class="card"><h3>Connected stores</h3><table><tr><th>Store</th><th>Provider</th><th>Status</th><th>Sync</th><th>Runtime events</th></tr>${stores.map((store) => `<tr><td>${store.name}</td><td>${store.provider}</td><td>${store.syncStatus}</td><td><form method="post" action="/commerce/stores/${store.id}/sync"><button>Sync catalog</button></form></td><td><form method="post" action="/commerce/stores/${store.id}/abandoned-cart"><input name="customerEmail" placeholder="customer@example.com"><input name="cartTotal" value="129"><input name="productSkus" placeholder="sku-1,sku-2"><button>Record cart</button></form><form method="post" action="/commerce/stores/${store.id}/recommendations"><input name="customerEmail" placeholder="customer@example.com"><input name="recommendationType" value="next_best_product"><button>Recommend</button></form></td></tr>`).join('') || '<tr><td colspan="5">No connected stores yet.</td></tr>'}</table></div><div class="grid"><div class="card"><h3>Product catalog</h3><table><tr><th>SKU</th><th>Name</th><th>Price</th></tr>${products.map((product) => `<tr><td>${product.sku}</td><td>${product.name}</td><td>$${product.price}</td></tr>`).join('') || '<tr><td colspan="3">Sync a commerce source to build the catalog.</td></tr>'}</table></div><div class="card"><h3>Recent orders</h3><table><tr><th>Order</th><th>Email</th><th>Total</th></tr>${orders.map((order) => `<tr><td>${order.orderNumber}</td><td>${order.customerEmail}</td><td>$${order.total}</td></tr>`).join('') || '<tr><td colspan="3">No orders synced yet.</td></tr>'}</table></div></div><div class="card"><h3>Revenue attribution rows</h3><table><tr><th>Order</th><th>Source</th><th>Campaign</th><th>Revenue</th></tr>${revenue.map((entry) => `<tr><td>${entry.orderId}</td><td>${entry.source}</td><td>${entry.campaignId || 'unattributed'}</td><td>$${entry.revenue}</td></tr>`).join('') || '<tr><td colspan="4">No attribution rows yet.</td></tr>'}</table></div>`));
  });

  router.register('POST', '/commerce/stores', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    connectStore(state, actor, await readBody(req));
    redirect(res, '/commerce');
  });

  router.register('POST', '/commerce/stores/:id/sync', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const store = state.db.commerceStores.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (store) syncCommerceStore(state, actor, store);
    redirect(res, '/commerce');
  });

  router.register('POST', '/commerce/stores/:id/abandoned-cart', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const store = state.db.commerceStores.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (store) recordAbandonedCartEvent(state, actor, store, await readBody(req));
    redirect(res, '/commerce');
  });

  router.register('POST', '/commerce/stores/:id/recommendations', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const body = await readBody(req);
    const store = state.db.commerceStores.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (store) {
      const products = state.db.commerceProducts.filter((entry) => entry.workspaceId === actor.workspace.id && entry.storeId === store.id).slice(0, 3).map((product) => ({ sku: product.sku, name: product.name, price: product.price }));
      recordProductRecommendationEvent(state, { workspaceId: actor.workspace.id, storeId: store.id, customerEmail: body.customerEmail || '', recommendationType: body.recommendationType || 'next_best_product', source: 'merchant_route', products });
      persistState(state);
    }
    redirect(res, '/commerce');
  });

  router.register('POST', '/commerce/runtime/snapshot', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    persistCommerceRevenueRuntimeSnapshot(state, actor, 'manual_route_snapshot');
    redirect(res, '/commerce');
  });

  router.register('GET', '/api/commerce/runtime', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    json(res, 200, { ok: true, commerceRuntime: buildCommerceRevenueRuntimeSnapshot(state, actor.workspace.id) });
  });
}
