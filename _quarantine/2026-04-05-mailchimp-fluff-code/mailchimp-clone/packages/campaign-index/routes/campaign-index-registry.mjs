import { buildCampaignIndexSnapshot, createCampaignIndexRouteSummary } from '../service-campaign-index.mjs';

export function createCampaignIndexRegistryRoutes(basePath = '/registry/campaign-index') {
  const snapshot = buildCampaignIndexSnapshot();
  return [
    { id: 'campaign-index.registry.summary', method: 'GET', path: basePath, summary: createCampaignIndexRouteSummary(snapshot) },
    { id: 'campaign-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

