import { buildActivationHubSnapshot, createActivationHubRouteSummary } from '../service-activation-hub.mjs';

export function createActivationHubDashboardRoutes(basePath = '/activation-hub') {
  const snapshot = buildActivationHubSnapshot();
  return [
    { id: 'activation-hub.dashboard.overview', method: 'GET', path: basePath, summary: createActivationHubRouteSummary(snapshot) },
    { id: 'activation-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

