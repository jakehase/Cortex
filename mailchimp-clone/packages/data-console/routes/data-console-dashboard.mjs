import { buildDataConsoleSnapshot, createDataConsoleRouteSummary } from '../service-data-console.mjs';

export function createDataConsoleDashboardRoutes(basePath = '/data-console') {
  const snapshot = buildDataConsoleSnapshot();
  return [
    { id: 'data-console.dashboard.overview', method: 'GET', path: basePath, summary: createDataConsoleRouteSummary(snapshot) },
    { id: 'data-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

