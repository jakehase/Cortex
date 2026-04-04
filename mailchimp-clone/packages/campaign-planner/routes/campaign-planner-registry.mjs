import { buildCampaignPlannerSnapshot, createCampaignPlannerRouteSummary } from '../service-campaign-planner.mjs';

export function createCampaignPlannerRegistryRoutes(basePath = '/registry/campaign-planner') {
  const snapshot = buildCampaignPlannerSnapshot();
  return [
    { id: 'campaign-planner.registry.summary', method: 'GET', path: basePath, summary: createCampaignPlannerRouteSummary(snapshot) },
    { id: 'campaign-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

