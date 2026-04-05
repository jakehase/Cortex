import { buildCampaignConsoleSnapshot, createCampaignConsoleRouteSummary } from '../service-campaign-console.mjs';

export function createCampaignConsoleDashboardRoutes(basePath = '/campaign-console') {
  const snapshot = buildCampaignConsoleSnapshot();
  return [
    { id: 'campaign-console.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignConsoleRouteSummary(snapshot) },
    { id: 'campaign-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

