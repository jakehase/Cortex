import { buildAttributionConsoleSnapshot, createAttributionConsoleRouteSummary } from '../service-attribution-console.mjs';

export function createAttributionConsoleDashboardRoutes(basePath = '/attribution-console') {
  const snapshot = buildAttributionConsoleSnapshot();
  return [
    { id: 'attribution-console.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionConsoleRouteSummary(snapshot) },
    { id: 'attribution-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

