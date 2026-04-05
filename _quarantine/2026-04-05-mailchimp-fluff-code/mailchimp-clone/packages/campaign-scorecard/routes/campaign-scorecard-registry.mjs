import { buildCampaignScorecardSnapshot, createCampaignScorecardRouteSummary } from '../service-campaign-scorecard.mjs';

export function createCampaignScorecardRegistryRoutes(basePath = '/registry/campaign-scorecard') {
  const snapshot = buildCampaignScorecardSnapshot();
  return [
    { id: 'campaign-scorecard.registry.summary', method: 'GET', path: basePath, summary: createCampaignScorecardRouteSummary(snapshot) },
    { id: 'campaign-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'campaign-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

