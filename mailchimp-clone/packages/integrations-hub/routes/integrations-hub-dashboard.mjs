import { buildIntegrationsHubSnapshot, createIntegrationsHubRouteSummary } from '../service-integrations-hub.mjs';

export function createIntegrationsHubDashboardRoutes(basePath = '/integrations-hub') {
  const snapshot = buildIntegrationsHubSnapshot();
  return [
    { id: 'integrations-hub.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsHubRouteSummary(snapshot) },
    { id: 'integrations-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

