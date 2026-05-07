import { persistState } from './storage.mjs';
import { createId, nowIso } from './utils.mjs';
import { recordAudit, recordEvent } from './domain-core.mjs';

export const COMMERCE_PROVIDERS = [
  { id: 'shopify', name: 'Shopify', channel: 'storefront' },
  { id: 'woocommerce', name: 'WooCommerce', channel: 'storefront' },
  { id: 'stripe', name: 'Stripe', channel: 'payments' }
];

function currencyValue(value) {
  return Number(Number(value || 0).toFixed(2));
}

export function workspaceStores(state, workspaceId) {
  return state.db.commerceStores.filter((entry) => entry.workspaceId === workspaceId);
}

export function workspaceRevenueRows(state, workspaceId) {
  return state.db.revenueAttributions.filter((entry) => entry.workspaceId === workspaceId);
}

export function connectStore(state, actor, body) {
  const providerId = COMMERCE_PROVIDERS.some((provider) => provider.id === body.provider) ? body.provider : 'shopify';
  const existing = state.db.commerceStores.find((entry) => entry.workspaceId === actor.workspace.id && entry.provider === providerId && entry.externalAccountId === String(body.externalAccountId || providerId));
  if (existing) return existing;

  const store = {
    id: createId('store'),
    workspaceId: actor.workspace.id,
    provider: providerId,
    name: body.name || `${providerId[0].toUpperCase()}${providerId.slice(1)} store`,
    currency: body.currency || 'USD',
    timezone: body.timezone || actor.workspace.settings.timezone || 'America/Chicago',
    status: 'connected',
    externalAccountId: String(body.externalAccountId || providerId),
    syncStatus: 'idle',
    lastSyncedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.db.commerceStores.unshift(store);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'commerce-store-connect', detail: `Connected ${store.provider} store ${store.name}` });
  return store;
}

function ensureCatalogForStore(state, store) {
  const existing = state.db.commerceProducts.filter((entry) => entry.storeId === store.id);
  if (existing.length) return { addedProducts: 0, products: existing };
  const products = [
    { id: createId('prod'), workspaceId: store.workspaceId, storeId: store.id, sku: `${store.provider}-starter`, name: 'Starter bundle', price: 39, inventory: 120, createdAt: nowIso() },
    { id: createId('prod'), workspaceId: store.workspaceId, storeId: store.id, sku: `${store.provider}-pro`, name: 'Pro bundle', price: 89, inventory: 74, createdAt: nowIso() },
    { id: createId('prod'), workspaceId: store.workspaceId, storeId: store.id, sku: `${store.provider}-vip`, name: 'VIP consulting add-on', price: 199, inventory: 18, createdAt: nowIso() }
  ];
  state.db.commerceProducts.unshift(...products);
  return { addedProducts: products.length, products };
}

function ensureOrdersForStore(state, store, actor) {
  const existing = state.db.commerceOrders.filter((entry) => entry.storeId === store.id);
  if (existing.length) return { addedOrders: 0, orders: existing };

  const candidateCampaign = state.db.campaigns.find((entry) => entry.workspaceId === store.workspaceId && ['sent', 'scheduled', 'queued', 'draft'].includes(entry.status));
  const sourceCampaignId = candidateCampaign?.id || null;
  const orders = [
    {
      id: createId('order'),
      workspaceId: store.workspaceId,
      storeId: store.id,
      orderNumber: `${store.provider.toUpperCase()}-1001`,
      customerEmail: 'buyer.one@example.com',
      total: 89,
      status: 'paid',
      sourceCampaignId,
      lineItems: [{ sku: `${store.provider}-pro`, quantity: 1, total: 89 }],
      createdAt: nowIso()
    },
    {
      id: createId('order'),
      workspaceId: store.workspaceId,
      storeId: store.id,
      orderNumber: `${store.provider.toUpperCase()}-1002`,
      customerEmail: 'buyer.two@example.com',
      total: 238,
      status: 'paid',
      sourceCampaignId,
      lineItems: [{ sku: `${store.provider}-starter`, quantity: 1, total: 39 }, { sku: `${store.provider}-vip`, quantity: 1, total: 199 }],
      createdAt: nowIso()
    }
  ];
  state.db.commerceOrders.unshift(...orders);

  const attributions = orders.map((order) => ({
    id: createId('rev'),
    workspaceId: store.workspaceId,
    storeId: store.id,
    orderId: order.id,
    campaignId: order.sourceCampaignId,
    revenue: order.total,
    source: order.sourceCampaignId ? 'campaign' : 'integration',
    createdAt: nowIso()
  }));
  state.db.revenueAttributions.unshift(...attributions);

  if (actor) {
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'commerce-order-sync', detail: `Synced ${orders.length} orders for ${store.name}` });
  }
  return { addedOrders: orders.length, orders };
}

export function syncCommerceStore(state, actor, store) {
  if (!store) throw new Error('Store is required');
  const catalog = ensureCatalogForStore(state, store);
  const orders = ensureOrdersForStore(state, store, actor);
  store.syncStatus = 'synced';
  store.lastSyncedAt = nowIso();
  store.updatedAt = nowIso();
  persistState(state);
  recordEvent(state, {
    workspaceId: store.workspaceId,
    type: 'commerce-sync',
    message: `${store.name} sync completed`,
    meta: { storeId: store.id, addedProducts: catalog.addedProducts, addedOrders: orders.addedOrders }
  });
  return {
    storeId: store.id,
    addedProducts: catalog.addedProducts,
    addedOrders: orders.addedOrders,
    revenueGenerated: currencyValue(orders.orders.reduce((sum, order) => sum + Number(order.total || 0), 0))
  };
}

function summarizeRevenueSources(rows = []) {
  const bySource = new Map();
  for (const row of rows) {
    const source = row.source || 'unknown';
    const current = bySource.get(source) || { source, revenue: 0, orders: 0, campaigns: new Set() };
    current.revenue += Number(row.revenue || 0);
    current.orders += 1;
    if (row.campaignId) current.campaigns.add(row.campaignId);
    bySource.set(source, current);
  }
  return [...bySource.values()]
    .map((entry) => ({
      source: entry.source,
      revenue: currencyValue(entry.revenue),
      orders: entry.orders,
      campaigns: entry.campaigns.size
    }))
    .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0));
}

function summarizeTopCampaigns(state, rows = []) {
  const byCampaign = new Map();
  for (const row of rows) {
    if (!row.campaignId) continue;
    const current = byCampaign.get(row.campaignId) || { campaignId: row.campaignId, revenue: 0, orders: 0 };
    current.revenue += Number(row.revenue || 0);
    current.orders += 1;
    byCampaign.set(row.campaignId, current);
  }
  return [...byCampaign.values()]
    .map((entry) => {
      const campaign = state.db.campaigns.find((candidate) => candidate.id === entry.campaignId) || null;
      return {
        campaignId: entry.campaignId,
        name: campaign?.name || 'Unknown campaign',
        status: campaign?.status || 'unknown',
        orders: entry.orders,
        revenue: currencyValue(entry.revenue)
      };
    })
    .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))
    .slice(0, 3);
}

function buildRecentRevenueActivity(orders = [], rows = []) {
  const rowsByOrderId = new Map(rows.map((row) => [row.orderId, row]));
  return orders
    .slice(0, 5)
    .map((order) => {
      const attribution = rowsByOrderId.get(order.id) || null;
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        total: currencyValue(order.total),
        source: attribution?.source || 'unknown',
        campaignId: attribution?.campaignId || null,
        createdAt: order.createdAt
      };
    });
}

export function revenueSummary(state, workspaceId) {
  const stores = workspaceStores(state, workspaceId);
  const orders = state.db.commerceOrders.filter((entry) => entry.workspaceId === workspaceId);
  const rows = workspaceRevenueRows(state, workspaceId);
  const totalRevenue = currencyValue(rows.reduce((sum, entry) => sum + Number(entry.revenue || 0), 0));
  const attributedRevenue = currencyValue(rows.filter((entry) => entry.campaignId).reduce((sum, entry) => sum + Number(entry.revenue || 0), 0));
  const topProduct = state.db.commerceProducts.filter((entry) => entry.workspaceId === workspaceId).sort((a, b) => Number(b.price || 0) - Number(a.price || 0))[0] || null;
  const averageOrderValue = orders.length ? currencyValue(totalRevenue / orders.length) : 0;
  const sourceBreakdown = summarizeRevenueSources(rows);
  const topCampaigns = summarizeTopCampaigns(state, rows);
  const recentActivity = buildRecentRevenueActivity(orders, rows);
  return {
    stores: stores.length,
    products: state.db.commerceProducts.filter((entry) => entry.workspaceId === workspaceId).length,
    orders: orders.length,
    totalRevenue,
    attributedRevenue,
    unattributedRevenue: currencyValue(totalRevenue - attributedRevenue),
    attributedShare: totalRevenue > 0 ? Number(((attributedRevenue / totalRevenue) * 100).toFixed(1)) : 0,
    averageOrderValue,
    topProduct: topProduct ? { name: topProduct.name, price: topProduct.price } : null,
    sourceBreakdown,
    topCampaigns,
    recentActivity
  };
}
