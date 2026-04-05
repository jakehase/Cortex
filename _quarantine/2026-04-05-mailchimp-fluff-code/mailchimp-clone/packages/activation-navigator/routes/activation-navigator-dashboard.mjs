import { buildActivationNavigatorSnapshot, createActivationNavigatorRouteSummary } from '../service-activation-navigator.mjs';

export function createActivationNavigatorDashboardRoutes(basePath = '/activation-navigator') {
  const snapshot = buildActivationNavigatorSnapshot();
  return [
    { id: 'activation-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createActivationNavigatorRouteSummary(snapshot) },
    { id: 'activation-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

