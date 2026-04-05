import { buildCampaignConsoleSnapshot, createCampaignConsoleRouteSummary } from '../service-campaign-console.mjs';

export function createCampaignConsoleRegistryRoutes(basePath = '/registry/campaign-console') {
  const snapshot = buildCampaignConsoleSnapshot();
  return [
    { id: 'campaign-console.registry.summary', method: 'GET', path: basePath, summary: createCampaignConsoleRouteSummary(snapshot) },
    { id: 'campaign-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

