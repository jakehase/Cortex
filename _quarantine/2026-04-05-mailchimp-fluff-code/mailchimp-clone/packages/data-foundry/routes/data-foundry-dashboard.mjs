import { buildDataFoundrySnapshot, createDataFoundryRouteSummary } from '../service-data-foundry.mjs';

export function createDataFoundryDashboardRoutes(basePath = '/data-foundry') {
  const snapshot = buildDataFoundrySnapshot();
  return [
    { id: 'data-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createDataFoundryRouteSummary(snapshot) },
    { id: 'data-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

