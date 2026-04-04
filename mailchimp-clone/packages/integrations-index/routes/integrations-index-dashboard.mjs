import { buildIntegrationsIndexSnapshot, createIntegrationsIndexRouteSummary } from '../service-integrations-index.mjs';

export function createIntegrationsIndexDashboardRoutes(basePath = '/integrations-index') {
  const snapshot = buildIntegrationsIndexSnapshot();
  return [
    { id: 'integrations-index.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsIndexRouteSummary(snapshot) },
    { id: 'integrations-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

