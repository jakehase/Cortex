import { buildCampaignStudioSnapshot, createCampaignStudioRouteSummary } from '../service-campaign-studio.mjs';

export function createCampaignStudioRegistryRoutes(basePath = '/registry/campaign-studio') {
  const snapshot = buildCampaignStudioSnapshot();
  return [
    { id: 'campaign-studio.registry.summary', method: 'GET', path: basePath, summary: createCampaignStudioRouteSummary(snapshot) },
    { id: 'campaign-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

