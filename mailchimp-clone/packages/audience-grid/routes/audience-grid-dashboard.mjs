import { buildAudienceGridSnapshot, createAudienceGridRouteSummary } from '../service-audience-grid.mjs';

export function createAudienceGridDashboardRoutes(basePath = '/audience-grid') {
  const snapshot = buildAudienceGridSnapshot();
  return [
    { id: 'audience-grid.dashboard.overview', method: 'GET', path: basePath, summary: createAudienceGridRouteSummary(snapshot) },
    { id: 'audience-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

