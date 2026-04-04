import { buildActivationWatchtowerSnapshot, createActivationWatchtowerRouteSummary } from '../service-activation-watchtower.mjs';

export function createActivationWatchtowerDashboardRoutes(basePath = '/activation-watchtower') {
  const snapshot = buildActivationWatchtowerSnapshot();
  return [
    { id: 'activation-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createActivationWatchtowerRouteSummary(snapshot) },
    { id: 'activation-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'activation-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

