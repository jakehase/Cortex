import { buildIntegrationsGridSnapshot, createIntegrationsGridRouteSummary } from '../service-integrations-grid.mjs';

export function createIntegrationsGridDashboardRoutes(basePath = '/integrations-grid') {
  const snapshot = buildIntegrationsGridSnapshot();
  return [
    { id: 'integrations-grid.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsGridRouteSummary(snapshot) },
    { id: 'integrations-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

