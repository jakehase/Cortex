import { buildCommerceConsoleSnapshot, createCommerceConsoleRouteSummary } from '../service-commerce-console.mjs';

export function createCommerceConsoleDashboardRoutes(basePath = '/commerce-console') {
  const snapshot = buildCommerceConsoleSnapshot();
  return [
    { id: 'commerce-console.dashboard.overview', method: 'GET', path: basePath, summary: createCommerceConsoleRouteSummary(snapshot) },
    { id: 'commerce-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'commerce-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

