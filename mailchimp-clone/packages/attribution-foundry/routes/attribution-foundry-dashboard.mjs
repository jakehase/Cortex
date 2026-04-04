import { buildAttributionFoundrySnapshot, createAttributionFoundryRouteSummary } from '../service-attribution-foundry.mjs';

export function createAttributionFoundryDashboardRoutes(basePath = '/attribution-foundry') {
  const snapshot = buildAttributionFoundrySnapshot();
  return [
    { id: 'attribution-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionFoundryRouteSummary(snapshot) },
    { id: 'attribution-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

