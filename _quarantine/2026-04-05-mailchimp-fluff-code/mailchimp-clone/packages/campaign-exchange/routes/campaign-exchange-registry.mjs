import { buildCampaignExchangeSnapshot, createCampaignExchangeRouteSummary } from '../service-campaign-exchange.mjs';

export function createCampaignExchangeRegistryRoutes(basePath = '/registry/campaign-exchange') {
  const snapshot = buildCampaignExchangeSnapshot();
  return [
    { id: 'campaign-exchange.registry.summary', method: 'GET', path: basePath, summary: createCampaignExchangeRouteSummary(snapshot) },
    { id: 'campaign-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

