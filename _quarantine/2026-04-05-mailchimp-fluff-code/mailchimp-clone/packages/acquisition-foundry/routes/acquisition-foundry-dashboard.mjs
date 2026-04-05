import { buildAcquisitionFoundrySnapshot, createAcquisitionFoundryRouteSummary } from '../service-acquisition-foundry.mjs';

export function createAcquisitionFoundryDashboardRoutes(basePath = '/acquisition-foundry') {
  const snapshot = buildAcquisitionFoundrySnapshot();
  return [
    { id: 'acquisition-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionFoundryRouteSummary(snapshot) },
    { id: 'acquisition-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

