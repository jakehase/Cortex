import { page } from '../view.mjs';
import { readBody, redirect, text } from '../utils.mjs';
import { MARKETPLACE_APPS, installMarketplaceApp, integrationMarketplaceSurfaceSummary, syncMarketplaceInstallation, workspaceIntegrationInstallations, workspaceIntegrationSummary } from '../domain-integration-marketplace.mjs';

export function registerIntegrationsMarketplaceRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/integrations', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const installations = workspaceIntegrationInstallations(state, actor.workspace.id);
    const summary = workspaceIntegrationSummary(state, actor.workspace.id);
    const surfaceSummary = integrationMarketplaceSurfaceSummary(state, actor.workspace.id);
    const syncRuns = state.db.integrationSyncRuns.filter((entry) => entry.workspaceId === actor.workspace.id).slice(0, 10);
    text(res, 200, page('Integrations marketplace', actor, `<div class="grid"><div class="card"><h3>Marketplace catalog</h3><table><tr><th>App</th><th>Category</th><th>Description</th><th>Action</th></tr>${MARKETPLACE_APPS.map((app) => `<tr><td>${app.name}</td><td>${app.category}</td><td>${app.description}</td><td>${installations.some((entry) => entry.appId === app.id) ? 'installed' : `<form method="post" action="/integrations/install"><input type="hidden" name="appId" value="${app.id}"><button>Install</button></form>`}</td></tr>`).join('')}</table></div><div class="card"><h3>Integration realism summary</h3><ul><li>Installed apps: ${summary.installedApps}</li><li>Commerce connectors: ${summary.commerceApps}</li><li>Collaboration connectors: ${summary.collaborationApps}</li><li>Last sync: ${summary.lastSyncAt || 'Never'}</li></ul><p>Connector detail pages now expose auth, config, field mapping, health, and retry workflows.</p></div><div class="card"><h3>Connector operations</h3><p>Connected apps: ${surfaceSummary.connectedApps}</p><p>Auth modes: ${surfaceSummary.authModes.join(', ' ) || 'oauth'}</p><p>Needs first sync: ${surfaceSummary.appsNeedingSync}</p><p>${surfaceSummary.lastSyncAt ? `Last verified sync: ${surfaceSummary.lastSyncAt}` : 'No verified sync yet.'}</p></div></div><div class="card"><h3>Installed connectors</h3><table><tr><th>Connector</th><th>Status</th><th>Scopes</th><th>Sync</th><th>Detail</th></tr>${installations.map((entry) => `<tr><td>${entry.app.name}</td><td>${entry.status}</td><td>${entry.scopes.join(', ')}</td><td><form method="post" action="/integrations/${entry.id}/sync"><button>Run sync</button></form></td><td><a href="/integrations/${entry.id}">Open</a></td></tr>`).join('') || '<tr><td colspan="5">No integrations installed yet.</td></tr>'}</table></div><div class="card"><h3>Sync history</h3><table><tr><th>App</th><th>Status</th><th>Contacts</th><th>Orders</th><th>Revenue</th></tr>${syncRuns.map((run) => `<tr><td>${run.appId}</td><td>${run.status}</td><td>${run.syncedContacts}</td><td>${run.syncedOrders}</td><td>$${run.syncedRevenue}</td></tr>`).join('') || '<tr><td colspan="5">No sync runs yet.</td></tr>'}</table></div>`));
  });

  router.register('POST', '/integrations/install', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    installMarketplaceApp(state, actor, (await readBody(req)).appId);
    redirect(res, '/integrations');
  });

  router.register('POST', '/integrations/:id/sync', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const installation = state.db.integrationInstallations.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (installation) await syncMarketplaceInstallation(state, actor, installation);
    redirect(res, '/integrations');
  });
}
