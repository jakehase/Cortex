import { buildAcquisitionWatchtowerSnapshot, createAcquisitionWatchtowerRouteSummary } from '../service-acquisition-watchtower.mjs';

export function createAcquisitionWatchtowerDashboardRoutes(basePath = '/acquisition-watchtower') {
  const snapshot = buildAcquisitionWatchtowerSnapshot();
  return [
    { id: 'acquisition-watchtower.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionWatchtowerRouteSummary(snapshot) },
    { id: 'acquisition-watchtower.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-watchtower.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

