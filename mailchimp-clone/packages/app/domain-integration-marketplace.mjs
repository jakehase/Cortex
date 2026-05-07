import { persistState } from './storage.mjs';
import { syncIntegrationProvider } from './integration-provider.mjs';
import { createId, nowIso } from './utils.mjs';
import { createNotification, recordAudit, recordEvent } from './domain-core.mjs';
import { COMMERCE_PROVIDERS, connectStore, revenueSummary, syncCommerceStore, workspaceStores } from './domain-commerce-revenue.mjs';

export const MARKETPLACE_APPS = [
  { id: 'shopify', name: 'Shopify', category: 'commerce', description: 'Sync products, orders, and revenue attribution.', scopes: ['read_orders', 'read_products'] },
  { id: 'woocommerce', name: 'WooCommerce', category: 'commerce', description: 'Import catalog and ecommerce events.', scopes: ['orders:read', 'products:read'] },
  { id: 'stripe', name: 'Stripe', category: 'commerce', description: 'Track payment conversions and LTV.', scopes: ['payments:read'] },
  { id: 'salesforce', name: 'Salesforce', category: 'crm', description: 'Map leads and account ownership.', scopes: ['contacts:read', 'accounts:read'] },
  { id: 'slack', name: 'Slack', category: 'collaboration', description: 'Deliver approval and send notifications.', scopes: ['chat:write'] }
];

function findApp(appId) {
  return MARKETPLACE_APPS.find((entry) => entry.id === appId) || MARKETPLACE_APPS[0];
}

export function workspaceIntegrationInstallations(state, workspaceId) {
  return state.db.integrationInstallations
    .filter((entry) => entry.workspaceId === workspaceId)
    .map((entry) => ({ ...entry, app: findApp(entry.appId) }));
}

export function integrationMarketplaceSurfaceSummary(state, workspaceId) {
  const installations = workspaceIntegrationInstallations(state, workspaceId);
  const syncRuns = state.db.integrationSyncRuns.filter((entry) => entry.workspaceId === workspaceId);
  return {
    installedApps: installations.length,
    connectedApps: installations.filter((entry) => entry.status === 'installed').length,
    authModes: Array.from(new Set(installations.map((entry) => entry.authMode || 'oauth'))),
    appsNeedingSync: installations.filter((entry) => !entry.lastSyncedAt).length,
    lastSyncAt: syncRuns[0]?.createdAt || null
  };
}

export function workspaceIntegrationSummary(state, workspaceId) {
  const installations = workspaceIntegrationInstallations(state, workspaceId);
  const syncRuns = state.db.integrationSyncRuns.filter((entry) => entry.workspaceId === workspaceId);
  return {
    installedApps: installations.length,
    commerceApps: installations.filter((entry) => entry.app.category === 'commerce').length,
    collaborationApps: installations.filter((entry) => entry.app.category === 'collaboration').length,
    lastSyncAt: syncRuns[0]?.createdAt || null
  };
}

export function installMarketplaceApp(state, actor, appId) {
  const app = findApp(appId);
  const existing = state.db.integrationInstallations.find((entry) => entry.workspaceId === actor.workspace.id && entry.appId === app.id);
  if (existing) return existing;
  const installation = {
    id: createId('integration'),
    workspaceId: actor.workspace.id,
    appId: app.id,
    authMode: 'oauth',
    status: 'installed',
    scopes: app.scopes,
    installedBy: actor.user.id,
    installedAt: nowIso(),
    lastSyncedAt: null
  };
  state.db.integrationInstallations.unshift(installation);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'integration-install', detail: `Installed ${app.name}` });
  createNotification(state, { workspaceId: actor.workspace.id, type: 'integration-installed', payload: { appId: app.id, appName: app.name } });
  return installation;
}

function ensureCommerceLink(state, actor, installation) {
  const provider = COMMERCE_PROVIDERS.find((entry) => entry.id === installation.appId);
  if (!provider) return null;
  const existingStore = workspaceStores(state, actor.workspace.id).find((entry) => entry.provider === provider.id);
  return existingStore || connectStore(state, actor, {
    provider: provider.id,
    name: `${provider.name} revenue store`,
    externalAccountId: installation.id,
    currency: 'USD'
  });
}

export async function syncMarketplaceInstallation(state, actor, installation) {
  if (!installation) throw new Error('Installation is required');
  const app = findApp(installation.appId);
  let commerceResult = null;
  if (app.category === 'commerce') {
    const store = ensureCommerceLink(state, actor, installation);
    commerceResult = syncCommerceStore(state, actor, store);
  }
  const providerResult = await syncIntegrationProvider(app, installation);
  const run = {
    id: createId('intsync'),
    workspaceId: actor.workspace.id,
    installationId: installation.id,
    appId: installation.appId,
    status: 'succeeded',
    syncedContacts: Number(providerResult?.syncedContacts || 0),
    syncedOrders: Number(providerResult?.syncedOrders || commerceResult?.addedOrders || 0),
    syncedRevenue: Number(providerResult?.syncedRevenue || commerceResult?.revenueGenerated || 0),
    createdAt: nowIso()
  };
  installation.lastSyncedAt = run.createdAt;
  installation.scopes = providerResult?.refreshedScopes || installation.scopes;
  state.db.integrationSyncRuns.unshift(run);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'integration-sync', detail: `Synced ${app.name}` });
  recordEvent(state, {
    workspaceId: actor.workspace.id,
    type: 'integration-sync',
    message: `${app.name} sync completed`,
    meta: { appId: app.id, installationId: installation.id, syncedOrders: run.syncedOrders }
  });
  return {
    run,
    revenue: revenueSummary(state, actor.workspace.id),
    commerceResult,
    providerResult
  };
}
