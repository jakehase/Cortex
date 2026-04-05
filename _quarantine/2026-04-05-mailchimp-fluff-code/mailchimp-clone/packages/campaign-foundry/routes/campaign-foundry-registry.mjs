import { buildCampaignFoundrySnapshot, createCampaignFoundryRouteSummary } from '../service-campaign-foundry.mjs';

export function createCampaignFoundryRegistryRoutes(basePath = '/registry/campaign-foundry') {
  const snapshot = buildCampaignFoundrySnapshot();
  return [
    { id: 'campaign-foundry.registry.summary', method: 'GET', path: basePath, summary: createCampaignFoundryRouteSummary(snapshot) },
    { id: 'campaign-foundry.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-foundry.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

