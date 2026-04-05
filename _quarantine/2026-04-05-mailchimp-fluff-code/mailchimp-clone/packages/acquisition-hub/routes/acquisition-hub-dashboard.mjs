import { buildAcquisitionHubSnapshot, createAcquisitionHubRouteSummary } from '../service-acquisition-hub.mjs';

export function createAcquisitionHubDashboardRoutes(basePath = '/acquisition-hub') {
  const snapshot = buildAcquisitionHubSnapshot();
  return [
    { id: 'acquisition-hub.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionHubRouteSummary(snapshot) },
    { id: 'acquisition-hub.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-hub.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

