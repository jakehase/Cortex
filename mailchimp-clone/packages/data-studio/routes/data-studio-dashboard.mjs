import { buildDataStudioSnapshot, createDataStudioRouteSummary } from '../service-data-studio.mjs';

export function createDataStudioDashboardRoutes(basePath = '/data-studio') {
  const snapshot = buildDataStudioSnapshot();
  return [
    { id: 'data-studio.dashboard.overview', method: 'GET', path: basePath, summary: createDataStudioRouteSummary(snapshot) },
    { id: 'data-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

