import { buildAcquisitionNavigatorSnapshot, createAcquisitionNavigatorRouteSummary } from '../service-acquisition-navigator.mjs';

export function createAcquisitionNavigatorDashboardRoutes(basePath = '/acquisition-navigator') {
  const snapshot = buildAcquisitionNavigatorSnapshot();
  return [
    { id: 'acquisition-navigator.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionNavigatorRouteSummary(snapshot) },
    { id: 'acquisition-navigator.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-navigator.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

