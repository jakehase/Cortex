import { buildCampaignGridSnapshot, createCampaignGridRouteSummary } from '../service-campaign-grid.mjs';

export function createCampaignGridDashboardRoutes(basePath = '/campaign-grid') {
  const snapshot = buildCampaignGridSnapshot();
  return [
    { id: 'campaign-grid.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignGridRouteSummary(snapshot) },
    { id: 'campaign-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

