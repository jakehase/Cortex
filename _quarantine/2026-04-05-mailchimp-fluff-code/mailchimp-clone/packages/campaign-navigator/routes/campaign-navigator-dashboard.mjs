import { buildCampaignNavigatorSnapshot, createCampaignNavigatorRouteSummary } from '../service-campaign-navigator.mjs';

export function createCampaignNavigatorDashboardRoutes(basePath = '/campaign-navigator') {
  const snapshot = buildCampaignNavigatorSnapshot();
  return [
    { id: 'campaign-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignNavigatorRouteSummary(snapshot) },
    { id: 'campaign-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

