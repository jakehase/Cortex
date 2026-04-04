import { buildAdvocacyConsoleSnapshot, createAdvocacyConsoleRouteSummary } from '../service-advocacy-console.mjs';

export function createAdvocacyConsoleDashboardRoutes(basePath = '/advocacy-console') {
  const snapshot = buildAdvocacyConsoleSnapshot();
  return [
    { id: 'advocacy-console.dashboard.overview', method: 'GET', path: basePath, summary: createAdvocacyConsoleRouteSummary(snapshot) },
    { id: 'advocacy-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'advocacy-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

