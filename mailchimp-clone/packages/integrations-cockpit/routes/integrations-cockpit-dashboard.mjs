import { buildIntegrationsCockpitSnapshot, createIntegrationsCockpitRouteSummary } from '../service-integrations-cockpit.mjs';

export function createIntegrationsCockpitDashboardRoutes(basePath = '/integrations-cockpit') {
  const snapshot = buildIntegrationsCockpitSnapshot();
  return [
    { id: 'integrations-cockpit.dashboard.overview', method: 'GET', path: basePath, summary: createIntegrationsCockpitRouteSummary(snapshot) },
    { id: 'integrations-cockpit.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'integrations-cockpit.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

