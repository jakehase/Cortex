import { buildIntegrationsNavigatorSnapshot, createIntegrationsNavigatorRouteSummary } from '../service-integrations-navigator.mjs';

export function createIntegrationsNavigatorDashboardRoutes(basePath = '/integrations-navigator') {
  const snapshot = buildIntegrationsNavigatorSnapshot();
  return [
    { id: 'integrations-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsNavigatorRouteSummary(snapshot) },
    { id: 'integrations-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

