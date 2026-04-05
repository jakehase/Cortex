import { buildAttributionIndexSnapshot, createAttributionIndexRouteSummary } from '../service-attribution-index.mjs';

export function createAttributionIndexDashboardRoutes(basePath = '/attribution-index') {
  const snapshot = buildAttributionIndexSnapshot();
  return [
    { id: 'attribution-index.dashboard.overview', method: 'GET', path: basePath, summary: createAttributionIndexRouteSummary(snapshot) },
    { id: 'attribution-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'attribution-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

