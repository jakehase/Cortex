import { buildCampaignHubSnapshot, createCampaignHubRouteSummary } from '../service-campaign-hub.mjs';

export function createCampaignHubDashboardRoutes(basePath = '/campaign-hub') {
  const snapshot = buildCampaignHubSnapshot();
  return [
    { id: 'campaign-hub.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignHubRouteSummary(snapshot) },
    { id: 'campaign-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

