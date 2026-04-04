import { buildCampaignWatchtowerSnapshot, createCampaignWatchtowerRouteSummary } from '../service-campaign-watchtower.mjs';

export function createCampaignWatchtowerDashboardRoutes(basePath = '/campaign-watchtower') {
  const snapshot = buildCampaignWatchtowerSnapshot();
  return [
    { id: 'campaign-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignWatchtowerRouteSummary(snapshot) },
    { id: 'campaign-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

