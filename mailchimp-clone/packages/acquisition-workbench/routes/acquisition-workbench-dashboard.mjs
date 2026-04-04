import { buildAcquisitionWorkbenchSnapshot, createAcquisitionWorkbenchRouteSummary } from '../service-acquisition-workbench.mjs';

export function createAcquisitionWorkbenchDashboardRoutes(basePath = '/acquisition-workbench') {
  const snapshot = buildAcquisitionWorkbenchSnapshot();
  return [
    { id: 'acquisition-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionWorkbenchRouteSummary(snapshot) },
    { id: 'acquisition-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

