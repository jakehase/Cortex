import { registerIntegrationsMarketplaceRoutes } from './integrations-marketplace.mjs';
import { connectorJourneyMap, customJourneyIntegrationSummary } from '../domain-custom-journeys.mjs';
import { page } from '../view.mjs';
import { escapeHtml, text } from '../utils.mjs';

export function registerIntegrationRoutes(router, deps) {
  registerIntegrationsMarketplaceRoutes(router, deps);
  const { requireAuth } = deps;

  router.register('GET', '/integrations/journey-map', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const summary = customJourneyIntegrationSummary(state, actor.workspace.id);
    const rows = connectorJourneyMap(state, actor.workspace.id);
    text(res, 200, page('Integration journey map', actor, `<div class="grid"><div class="card"><h3>Connector handoff summary</h3><p>Installations: ${summary.installations} · active: ${summary.activeInstallations}</p><p>Webhooks: ${summary.webhooks} · active: ${summary.activeWebhooks}</p><p>Journey handoffs: ${summary.journeyHandoffs}</p></div><div class="card"><h3>Connector families</h3><p>${summary.connectorFamilies.map(escapeHtml).join(', ') || 'No connectors installed yet.'}</p><p><a href="/integrations">Open marketplace</a></p></div></div><div class="card"><table><tr><th>Provider</th><th>Status</th><th>Mapped journeys</th></tr>${rows.map((row) => `<tr><td>${escapeHtml(row.provider || 'unknown')}</td><td>${escapeHtml(row.status || 'draft')}</td><td>${row.mappedJourneys.map((journey) => `${escapeHtml(journey.name)} (${escapeHtml(journey.trigger)})`).join('<br>') || 'No journey handoff yet'}</td></tr>`).join('') || '<tr><td colspan="3">No connector map yet.</td></tr>'}</table></div>`));
  });
}
