import { buildContentConsoleSnapshot, createContentConsoleRouteSummary } from '../service-content-console.mjs';

export function createContentConsoleDashboardRoutes(basePath = '/content-console') {
  const snapshot = buildContentConsoleSnapshot();
  return [
    { id: 'content-console.dashboard.overview', method: 'GET', path: basePath, summary: createContentConsoleRouteSummary(snapshot) },
    { id: 'content-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

