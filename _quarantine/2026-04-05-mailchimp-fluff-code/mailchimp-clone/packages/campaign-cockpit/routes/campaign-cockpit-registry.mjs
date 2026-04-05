import { buildCampaignCockpitSnapshot, createCampaignCockpitRouteSummary } from '../service-campaign-cockpit.mjs';

export function createCampaignCockpitRegistryRoutes(basePath = '/registry/campaign-cockpit') {
  const snapshot = buildCampaignCockpitSnapshot();
  return [
    { id: 'campaign-cockpit.registry.summary', method: 'GET', path: basePath, summary: createCampaignCockpitRouteSummary(snapshot) },
    { id: 'campaign-cockpit.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-cockpit.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

