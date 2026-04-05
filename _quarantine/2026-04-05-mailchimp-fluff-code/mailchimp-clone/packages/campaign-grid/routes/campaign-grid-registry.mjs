import { buildCampaignGridSnapshot, createCampaignGridRouteSummary } from '../service-campaign-grid.mjs';

export function createCampaignGridRegistryRoutes(basePath = '/registry/campaign-grid') {
  const snapshot = buildCampaignGridSnapshot();
  return [
    { id: 'campaign-grid.registry.summary', method: 'GET', path: basePath, summary: createCampaignGridRouteSummary(snapshot) },
    { id: 'campaign-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

