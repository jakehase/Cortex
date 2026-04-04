import { buildAdvocacyGridSnapshot, createAdvocacyGridRouteSummary } from '../service-advocacy-grid.mjs';

export function createAdvocacyGridDashboardRoutes(basePath = '/advocacy-grid') {
  const snapshot = buildAdvocacyGridSnapshot();
  return [
    { id: 'advocacy-grid.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyGridRouteSummary(snapshot) },
    { id: 'advocacy-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

