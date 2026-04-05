import { buildAudienceWorkbenchSnapshot, createAudienceWorkbenchRouteSummary } from '../service-audience-workbench.mjs';

export function createAudienceWorkbenchDashboardRoutes(basePath = '/audience-workbench') {
  const snapshot = buildAudienceWorkbenchSnapshot();
  return [
    { id: 'audience-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceWorkbenchRouteSummary(snapshot) },
    { id: 'audience-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

