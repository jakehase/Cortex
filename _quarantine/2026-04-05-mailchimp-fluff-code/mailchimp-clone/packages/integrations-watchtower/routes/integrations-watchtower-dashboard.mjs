import { buildIntegrationsWatchtowerSnapshot, createIntegrationsWatchtowerRouteSummary } from '../service-integrations-watchtower.mjs';

export function createIntegrationsWatchtowerDashboardRoutes(basePath = '/integrations-watchtower') {
  const snapshot = buildIntegrationsWatchtowerSnapshot();
  return [
    { id: 'integrations-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsWatchtowerRouteSummary(snapshot) },
    { id: 'integrations-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

