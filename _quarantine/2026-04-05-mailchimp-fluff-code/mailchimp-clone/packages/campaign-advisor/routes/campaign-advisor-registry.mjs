import { buildCampaignAdvisorSnapshot, createCampaignAdvisorRouteSummary } from '../service-campaign-advisor.mjs';

export function createCampaignAdvisorRegistryRoutes(basePath = '/registry/campaign-advisor') {
  const snapshot = buildCampaignAdvisorSnapshot();
  return [
    { id: 'campaign-advisor.registry.summary', method: 'GET', path: basePath, summary: createCampaignAdvisorRouteSummary(snapshot) },
    { id: 'campaign-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

