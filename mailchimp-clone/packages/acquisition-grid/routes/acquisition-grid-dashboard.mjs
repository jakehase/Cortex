import { buildAcquisitionGridSnapshot, createAcquisitionGridRouteSummary } from '../service-acquisition-grid.mjs';

export function createAcquisitionGridDashboardRoutes(basePath = '/acquisition-grid') {
  const snapshot = buildAcquisitionGridSnapshot();
  return [
    { id: 'acquisition-grid.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionGridRouteSummary(snapshot) },
    { id: 'acquisition-grid.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-grid.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

