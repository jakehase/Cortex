import { buildIntegrationsStudioSnapshot, createIntegrationsStudioRouteSummary } from '../service-integrations-studio.mjs';

export function createIntegrationsStudioDashboardRoutes(basePath = '/integrations-studio') {
  const snapshot = buildIntegrationsStudioSnapshot();
  return [
    { id: 'integrations-studio.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsStudioRouteSummary(snapshot) },
    { id: 'integrations-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

