import { buildCampaignHubSnapshot, createCampaignHubRouteSummary } from '../service-campaign-hub.mjs';

export function createCampaignHubRegistryRoutes(basePath = '/registry/campaign-hub') {
  const snapshot = buildCampaignHubSnapshot();
  return [
    { id: 'campaign-hub.registry.summary', method: 'GET', path: basePath, summary: createCampaignHubRouteSummary(snapshot) },
    { id: 'campaign-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

