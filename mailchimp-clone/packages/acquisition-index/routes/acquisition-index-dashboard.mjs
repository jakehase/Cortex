import { buildAcquisitionIndexSnapshot, createAcquisitionIndexRouteSummary } from '../service-acquisition-index.mjs';

export function createAcquisitionIndexDashboardRoutes(basePath = '/acquisition-index') {
  const snapshot = buildAcquisitionIndexSnapshot();
  return [
    { id: 'acquisition-index.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionIndexRouteSummary(snapshot) },
    { id: 'acquisition-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

