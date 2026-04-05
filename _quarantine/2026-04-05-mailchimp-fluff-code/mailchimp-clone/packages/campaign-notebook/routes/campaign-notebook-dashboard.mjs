import { buildCampaignNotebookSnapshot, createCampaignNotebookRouteSummary } from '../service-campaign-notebook.mjs';

export function createCampaignNotebookDashboardRoutes(basePath = '/campaign-notebook') {
  const snapshot = buildCampaignNotebookSnapshot();
  return [
    { id: 'campaign-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createCampaignNotebookRouteSummary(snapshot) },
    { id: 'campaign-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'campaign-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

