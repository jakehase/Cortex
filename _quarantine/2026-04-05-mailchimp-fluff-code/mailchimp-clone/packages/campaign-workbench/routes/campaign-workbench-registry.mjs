import { buildCampaignWorkbenchSnapshot, createCampaignWorkbenchRouteSummary } from '../service-campaign-workbench.mjs';

export function createCampaignWorkbenchRegistryRoutes(basePath = '/registry/campaign-workbench') {
  const snapshot = buildCampaignWorkbenchSnapshot();
  return [
    { id: 'campaign-workbench.registry.summary', method: 'GET', path: basePath, summary: createCampaignWorkbenchRouteSummary(snapshot) },
    { id: 'campaign-workbench.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-workbench.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

