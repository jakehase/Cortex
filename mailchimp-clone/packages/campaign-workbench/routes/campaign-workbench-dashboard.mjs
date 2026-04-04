import { buildCampaignWorkbenchSnapshot, createCampaignWorkbenchRouteSummary } from '../service-campaign-workbench.mjs';

export function createCampaignWorkbenchDashboardRoutes(basePath = '/campaign-workbench') {
  const snapshot = buildCampaignWorkbenchSnapshot();
  return [
    { id: 'campaign-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignWorkbenchRouteSummary(snapshot) },
    { id: 'campaign-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

