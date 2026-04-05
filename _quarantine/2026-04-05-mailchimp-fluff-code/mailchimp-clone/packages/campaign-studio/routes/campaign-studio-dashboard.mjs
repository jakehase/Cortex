import { buildCampaignStudioSnapshot, createCampaignStudioRouteSummary } from '../service-campaign-studio.mjs';

export function createCampaignStudioDashboardRoutes(basePath = '/campaign-studio') {
  const snapshot = buildCampaignStudioSnapshot();
  return [
    { id: 'campaign-studio.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignStudioRouteSummary(snapshot) },
    { id: 'campaign-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

