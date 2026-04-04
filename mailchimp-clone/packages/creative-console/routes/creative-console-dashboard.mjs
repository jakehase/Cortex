import { buildCreativeConsoleSnapshot, createCreativeConsoleRouteSummary } from '../service-creative-console.mjs';

export function createCreativeConsoleDashboardRoutes(basePath = '/creative-console') {
  const snapshot = buildCreativeConsoleSnapshot();
  return [
    { id: 'creative-console.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeConsoleRouteSummary(snapshot) },
    { id: 'creative-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

