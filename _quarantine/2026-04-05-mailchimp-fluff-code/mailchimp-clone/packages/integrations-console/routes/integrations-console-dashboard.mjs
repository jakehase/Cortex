import { buildIntegrationsConsoleSnapshot, createIntegrationsConsoleRouteSummary } from '../service-integrations-console.mjs';

export function createIntegrationsConsoleDashboardRoutes(basePath = '/integrations-console') {
  const snapshot = buildIntegrationsConsoleSnapshot();
  return [
    { id: 'integrations-console.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsConsoleRouteSummary(snapshot) },
    { id: 'integrations-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

