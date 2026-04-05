import { buildAcquisitionStudioSnapshot, createAcquisitionStudioRouteSummary } from '../service-acquisition-studio.mjs';

export function createAcquisitionStudioDashboardRoutes(basePath = '/acquisition-studio') {
  const snapshot = buildAcquisitionStudioSnapshot();
  return [
    { id: 'acquisition-studio.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionStudioRouteSummary(snapshot) },
    { id: 'acquisition-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

