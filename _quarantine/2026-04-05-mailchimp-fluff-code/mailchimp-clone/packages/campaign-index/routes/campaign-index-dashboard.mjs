import { buildCampaignIndexSnapshot, createCampaignIndexRouteSummary } from '../service-campaign-index.mjs';

export function createCampaignIndexDashboardRoutes(basePath = '/campaign-index') {
  const snapshot = buildCampaignIndexSnapshot();
  return [
    { id: 'campaign-index.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignIndexRouteSummary(snapshot) },
    { id: 'campaign-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

