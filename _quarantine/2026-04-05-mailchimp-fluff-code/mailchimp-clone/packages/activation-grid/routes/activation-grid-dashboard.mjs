import { buildActivationGridSnapshot, createActivationGridRouteSummary } from '../service-activation-grid.mjs';

export function createActivationGridDashboardRoutes(basePath = '/activation-grid') {
  const snapshot = buildActivationGridSnapshot();
  return [
    { id: 'activation-grid.dashboard.overview', method: 'GET', path: basePath, summary: createActivationGridRouteSummary(snapshot) },
    { id: 'activation-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

