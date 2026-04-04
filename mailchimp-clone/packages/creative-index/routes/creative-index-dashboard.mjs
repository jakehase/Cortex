import { buildCreativeIndexSnapshot, createCreativeIndexRouteSummary } from '../service-creative-index.mjs';

export function createCreativeIndexDashboardRoutes(basePath = '/creative-index') {
  const snapshot = buildCreativeIndexSnapshot();
  return [
    { id: 'creative-index.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeIndexRouteSummary(snapshot) },
    { id: 'creative-index.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-index.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

