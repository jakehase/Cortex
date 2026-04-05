import { buildCampaignNavigatorSnapshot, createCampaignNavigatorRouteSummary } from '../service-campaign-navigator.mjs';

export function createCampaignNavigatorRegistryRoutes(basePath = '/registry/campaign-navigator') {
  const snapshot = buildCampaignNavigatorSnapshot();
  return [
    { id: 'campaign-navigator.registry.summary', method: 'GET', path: basePath, summary: createCampaignNavigatorRouteSummary(snapshot) },
    { id: 'campaign-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

