import { buildCampaignWatchtowerSnapshot, createCampaignWatchtowerRouteSummary } from '../service-campaign-watchtower.mjs';

export function createCampaignWatchtowerRegistryRoutes(basePath = '/registry/campaign-watchtower') {
  const snapshot = buildCampaignWatchtowerSnapshot();
  return [
    { id: 'campaign-watchtower.registry.summary', method: 'GET', path: basePath, summary: createCampaignWatchtowerRouteSummary(snapshot) },
    { id: 'campaign-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

