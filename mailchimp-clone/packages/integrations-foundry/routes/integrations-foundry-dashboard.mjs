import { buildIntegrationsFoundrySnapshot, createIntegrationsFoundryRouteSummary } from '../service-integrations-foundry.mjs';

export function createIntegrationsFoundryDashboardRoutes(basePath = '/integrations-foundry') {
  const snapshot = buildIntegrationsFoundrySnapshot();
  return [
    { id: 'integrations-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsFoundryRouteSummary(snapshot) },
    { id: 'integrations-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

