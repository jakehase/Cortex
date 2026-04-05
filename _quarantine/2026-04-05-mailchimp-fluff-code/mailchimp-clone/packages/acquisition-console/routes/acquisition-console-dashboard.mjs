import { buildAcquisitionConsoleSnapshot, createAcquisitionConsoleRouteSummary } from '../service-acquisition-console.mjs';

export function createAcquisitionConsoleDashboardRoutes(basePath = '/acquisition-console') {
  const snapshot = buildAcquisitionConsoleSnapshot();
  return [
    { id: 'acquisition-console.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionConsoleRouteSummary(snapshot) },
    { id: 'acquisition-console.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-console.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

