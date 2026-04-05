import { buildIntegrationsWorkbenchSnapshot, createIntegrationsWorkbenchRouteSummary } from '../service-integrations-workbench.mjs';

export function createIntegrationsWorkbenchDashboardRoutes(basePath = '/integrations-workbench') {
  const snapshot = buildIntegrationsWorkbenchSnapshot();
  return [
    { id: 'integrations-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsWorkbenchRouteSummary(snapshot) },
    { id: 'integrations-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

