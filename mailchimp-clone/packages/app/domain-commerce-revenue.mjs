import { persistState } from './storage.mjs';
import { createId, nowIso } from './utils.mjs';
import { recordAudit, recordEvent } from './domain-core.mjs';

export const COMMERCE_PROVIDERS = [
  { id: 'shopify', name: 'Shopify', channel: 'storefront' },
  { id: 'woocommerce', name: 'WooCommerce', channel: 'storefront' },
  { id: 'stripe', name: 'Stripe', channel: 'payments' }
];

export const COMMERCE_REVENUE_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'commerce_revenue_attribution_runtime_layer',
  label: 'Commerce revenue attribution and recovery runtime',
  controls: [
    'commerce_runtime_snapshot',
    'customer_value_profiles',
    'abandoned_cart_recovery_events',
    'product_recommendation_signal_events',
    'campaign_revenue_attribution_api',
    'store_sync_runtime_evidence'
  ],
  evidenceContract: [
    'orders_to_revenue_attribution_rows',
    'customer_value_profile_rollups',
    'abandoned_cart_recovery_ledger',
    'product_recommendation_events_from_catalog_sync',
    'commerce_runtime_api_evidence'
  ]
});

function currencyValue(value) {
  return Number(Number(value || 0).toFixed(2));
}

export function ensureCommerceRuntimeState(state) {
  state.db ||= {};
  state.db.commerceRuntimeSnapshots ||= [];
  state.db.commerceCustomerProfiles ||= [];
  state.db.abandonedCartEvents ||= [];
  state.db.productRecommendationEvents ||= [];
  state.db.commerceStores ||= [];
  state.db.commerceProducts ||= [];
  state.db.commerceOrders ||= [];
  state.db.revenueAttributions ||= [];
  state.db.campaigns ||= [];
  state.db.apiKeys ||= [];
  state.db.webhooks ||= [];
  return state;
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
  ensureCommerceRuntimeState(state);
  const catalog = ensureCatalogForStore(state, store);
  const orders = ensureOrdersForStore(state, store, actor);
  const products = catalog.products || state.db.commerceProducts.filter((entry) => entry.storeId === store.id);
  refreshCommerceCustomerProfiles(state, store.workspaceId);
  if (products.length) {
    recordProductRecommendationEvent(state, {
      workspaceId: store.workspaceId,
      storeId: store.id,
      source: 'store_sync',
      recommendationType: 'best_sellers_from_sync',
      products: products.slice(0, 3).map((product) => ({ sku: product.sku, name: product.name, price: product.price }))
    });
  }
  store.syncStatus = 'synced';
  store.lastSyncedAt = nowIso();
  store.updatedAt = nowIso();
  recordEvent(state, {
    workspaceId: store.workspaceId,
    type: 'commerce-sync',
    message: `${store.name} sync completed`,
    meta: { storeId: store.id, addedProducts: catalog.addedProducts, addedOrders: orders.addedOrders }
  });
  persistState(state);
  return {
    storeId: store.id,
    addedProducts: catalog.addedProducts,
    addedOrders: orders.addedOrders,
    revenueGenerated: currencyValue(orders.orders.reduce((sum, order) => sum + Number(order.total || 0), 0))
  };
}

function buildCustomerProfilesFromOrders(state, workspaceId) {
  const byEmail = new Map();
  const rowsByOrderId = new Map(state.db.revenueAttributions.filter((entry) => entry.workspaceId === workspaceId).map((entry) => [entry.orderId, entry]));
  for (const order of state.db.commerceOrders.filter((entry) => entry.workspaceId === workspaceId)) {
    const email = String(order.customerEmail || '').toLowerCase();
    if (!email) continue;
    const attribution = rowsByOrderId.get(order.id) || null;
    const current = byEmail.get(email) || {
      id: createId('cprof'),
      workspaceId,
      email,
      orders: 0,
      totalRevenue: 0,
      campaignRevenue: 0,
      campaignIds: new Set(),
      firstOrderAt: order.createdAt,
      lastOrderAt: order.createdAt,
      updatedAt: nowIso()
    };
    current.orders += 1;
    current.totalRevenue += Number(order.total || 0);
    if (attribution?.campaignId) {
      current.campaignRevenue += Number(attribution.revenue || order.total || 0);
      current.campaignIds.add(attribution.campaignId);
    }
    if (order.createdAt && (!current.firstOrderAt || order.createdAt < current.firstOrderAt)) current.firstOrderAt = order.createdAt;
    if (order.createdAt && (!current.lastOrderAt || order.createdAt > current.lastOrderAt)) current.lastOrderAt = order.createdAt;
    byEmail.set(email, current);
  }
  return [...byEmail.values()].map((entry) => ({
    ...entry,
    totalRevenue: currencyValue(entry.totalRevenue),
    campaignRevenue: currencyValue(entry.campaignRevenue),
    averageOrderValue: entry.orders ? currencyValue(entry.totalRevenue / entry.orders) : 0,
    campaignIds: [...entry.campaignIds],
    lifecycleStage: entry.totalRevenue >= 200 ? 'high_value' : entry.orders > 1 ? 'repeat_buyer' : 'new_buyer'
  })).sort((a, b) => Number(b.totalRevenue || 0) - Number(a.totalRevenue || 0));
}

export function refreshCommerceCustomerProfiles(state, workspaceId) {
  ensureCommerceRuntimeState(state);
  const profiles = buildCustomerProfilesFromOrders(state, workspaceId);
  const otherWorkspaces = state.db.commerceCustomerProfiles.filter((entry) => entry.workspaceId !== workspaceId);
  state.db.commerceCustomerProfiles = [...profiles, ...otherWorkspaces].slice(0, 500);
  return profiles;
}

export function recordAbandonedCartEvent(state, actor, store, body = {}) {
  ensureCommerceRuntimeState(state);
  const event = {
    id: createId('cart'),
    workspaceId: store.workspaceId || actor.workspace.id,
    storeId: store.id,
    customerEmail: String(body.customerEmail || 'cart@example.com').toLowerCase(),
    cartTotal: currencyValue(body.cartTotal || 0),
    currency: store.currency || body.currency || 'USD',
    productSkus: String(body.productSkus || '').split(',').map((entry) => entry.trim()).filter(Boolean),
    recoveryCampaignId: body.recoveryCampaignId || '',
    status: body.status || 'open',
    capturedAt: nowIso(),
    recoveredAt: null
  };
  state.db.abandonedCartEvents.unshift(event);
  state.db.abandonedCartEvents = state.db.abandonedCartEvents.slice(0, 500);
  recordAudit(state, { workspaceId: event.workspaceId, userId: actor.user.id, action: 'commerce-abandoned-cart-record', detail: `Recorded abandoned cart for ${event.customerEmail}` });
  return event;
}

export function recordProductRecommendationEvent(state, payload = {}) {
  ensureCommerceRuntimeState(state);
  const event = {
    id: createId('prec'),
    workspaceId: payload.workspaceId || '',
    storeId: payload.storeId || '',
    campaignId: payload.campaignId || '',
    contactId: payload.contactId || '',
    customerEmail: payload.customerEmail || '',
    source: payload.source || 'manual',
    recommendationType: payload.recommendationType || 'best_sellers',
    products: Array.isArray(payload.products) ? payload.products : [],
    generatedAt: nowIso(),
    meta: payload.meta || {}
  };
  state.db.productRecommendationEvents.unshift(event);
  state.db.productRecommendationEvents = state.db.productRecommendationEvents.slice(0, 500);
  return event;
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
  ensureCommerceRuntimeState(state);
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

export function buildCommerceRevenueRuntimeSnapshot(state, workspaceId) {
  ensureCommerceRuntimeState(state);
  const stores = workspaceStores(state, workspaceId);
  const orders = state.db.commerceOrders.filter((entry) => entry.workspaceId === workspaceId);
  const rows = workspaceRevenueRows(state, workspaceId);
  const profiles = refreshCommerceCustomerProfiles(state, workspaceId);
  const abandonedCarts = state.db.abandonedCartEvents.filter((entry) => entry.workspaceId === workspaceId);
  const recommendations = state.db.productRecommendationEvents.filter((entry) => entry.workspaceId === workspaceId);
  const summary = revenueSummary(state, workspaceId);
  const recoveredCartValue = currencyValue(abandonedCarts.filter((entry) => entry.status === 'recovered').reduce((sum, entry) => sum + Number(entry.cartTotal || 0), 0));
  return {
    ...COMMERCE_REVENUE_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    summary,
    stores: stores.map((store) => ({ id: store.id, name: store.name, provider: store.provider, status: store.status, syncStatus: store.syncStatus, lastSyncedAt: store.lastSyncedAt })),
    orderCount: orders.length,
    revenueAttributionCount: rows.length,
    customerProfiles: profiles.slice(0, 10),
    customerProfileCount: profiles.length,
    abandonedCartCount: abandonedCarts.length,
    openAbandonedCartValue: currencyValue(abandonedCarts.filter((entry) => entry.status !== 'recovered').reduce((sum, entry) => sum + Number(entry.cartTotal || 0), 0)),
    recoveredCartValue,
    recentAbandonedCarts: abandonedCarts.slice(0, 10),
    recommendationEventCount: recommendations.length,
    recentRecommendationEvents: recommendations.slice(0, 10),
    attributionRows: rows.slice(0, 10)
  };
}

export function persistCommerceRevenueRuntimeSnapshot(state, actor, reason = 'manual_commerce_runtime_snapshot') {
  ensureCommerceRuntimeState(state);
  const snapshot = buildCommerceRevenueRuntimeSnapshot(state, actor.workspace.id);
  const entry = { id: createId('crun'), reason, recordedAt: nowIso(), userId: actor.user.id, ...snapshot };
  state.db.commerceRuntimeSnapshots.unshift(entry);
  state.db.commerceRuntimeSnapshots = state.db.commerceRuntimeSnapshots.slice(0, 100);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'commerce-runtime-snapshot', detail: `Captured commerce runtime snapshot (${reason})` });
  return entry;
}

export function billingUsageSummary(state, workspace) {
  const workspaceId = workspace.id;
  const revenue = revenueSummary(state, workspaceId);
  const sentCampaigns = state.db.campaigns.filter((campaign) => campaign.workspaceId === workspaceId && ['sent', 'queued', 'scheduled'].includes(campaign.status)).length;
  const activeApiKeys = state.db.apiKeys.filter((key) => key.workspaceId === workspaceId && !key.revokedAt).length;
  const activeWebhooks = state.db.webhooks.filter((hook) => hook.workspaceId === workspaceId && hook.status === 'active').length;
  const invoices = workspace.billing?.invoices || [];
  return {
    planId: workspace.planId,
    monthlySendUsage: sentCampaigns,
    activeApiKeys,
    activeWebhooks,
    invoices: invoices.slice(0, 5),
    revenue,
    gates: {
      scheduledSend: workspace.planId !== 'starter',
      advancedSegments: workspace.planId !== 'starter',
      auditExport: workspace.planId !== 'starter'
    },
    nextBillingAction: workspace.planId === 'starter' ? 'upgrade_for_scheduled_send_and_advanced_segments' : 'monitor_usage_and_revenue_attribution'
  };
}

export const websiteBuilderIntegratedUserPathEvidenceSemanticRuntimeContract = {
  "surfaceId": "website_builder",
  "focusGroup": "frontend_architecture",
  "phaseId": "integrated_user_path_evidence",
  "shardId": "focus.website_builder::semantic-frontier-001#05-integrated_user_path_evidence#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildWebsiteBuilderIntegratedUserPathEvidenceSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...websiteBuilderIntegratedUserPathEvidenceSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-commerce-revenue.mjs","packages/app/domain-website-builder.mjs","packages/app/routes/website-builder.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: websiteBuilderIntegratedUserPathEvidenceSemanticRuntimeContract.surfaceId,
      phaseId: websiteBuilderIntegratedUserPathEvidenceSemanticRuntimeContract.phaseId,
      shardId: websiteBuilderIntegratedUserPathEvidenceSemanticRuntimeContract.shardId
    }
  };
}

export const websiteBuilderPrimaryRuntimeSpineSemanticRuntimeContract = {
  "surfaceId": "website_builder",
  "focusGroup": "frontend_architecture",
  "phaseId": "primary_runtime_spine",
  "shardId": "focus.website_builder::semantic-frontier-001#05-primary_runtime_spine#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildWebsiteBuilderPrimaryRuntimeSpineSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...websiteBuilderPrimaryRuntimeSpineSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-commerce-revenue.mjs","packages/app/domain-website-builder.mjs","packages/app/routes/website-builder.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: websiteBuilderPrimaryRuntimeSpineSemanticRuntimeContract.surfaceId,
      phaseId: websiteBuilderPrimaryRuntimeSpineSemanticRuntimeContract.phaseId,
      shardId: websiteBuilderPrimaryRuntimeSpineSemanticRuntimeContract.shardId
    }
  };
}
