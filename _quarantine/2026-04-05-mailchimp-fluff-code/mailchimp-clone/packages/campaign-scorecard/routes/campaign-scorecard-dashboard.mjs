import { buildCampaignScorecardSnapshot, createCampaignScorecardRouteSummary } from '../service-campaign-scorecard.mjs';

export function createCampaignScorecardDashboardRoutes(basePath = '/campaign-scorecard') {
  const snapshot = buildCampaignScorecardSnapshot();
  return [
    { id: 'campaign-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignScorecardRouteSummary(snapshot) },
    { id: 'campaign-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

