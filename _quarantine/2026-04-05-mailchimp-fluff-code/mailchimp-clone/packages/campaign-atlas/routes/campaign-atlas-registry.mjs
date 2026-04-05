import { buildCampaignAtlasSnapshot, createCampaignAtlasRouteSummary } from '../service-campaign-atlas.mjs';

export function createCampaignAtlasRegistryRoutes(basePath = '/registry/campaign-atlas') {
  const snapshot = buildCampaignAtlasSnapshot();
  return [
    { id: 'campaign-atlas.registry.summary', method: 'GET', path: basePath, summary: createCampaignAtlasRouteSummary(snapshot) },
    { id: 'campaign-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

