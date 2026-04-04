import { buildDataIndexSnapshot, createDataIndexRouteSummary } from '../service-data-index.mjs';

export function createDataIndexDashboardRoutes(basePath = '/data-index') {
  const snapshot = buildDataIndexSnapshot();
  return [
    { id: 'data-index.dashboard.overview', method: 'GET', path: basePath, summary: createDataIndexRouteSummary(snapshot) },
    { id: 'data-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

