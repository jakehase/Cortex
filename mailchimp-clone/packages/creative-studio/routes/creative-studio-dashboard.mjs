import { buildCreativeStudioSnapshot, createCreativeStudioRouteSummary } from '../service-creative-studio.mjs';

export function createCreativeStudioDashboardRoutes(basePath = '/creative-studio') {
  const snapshot = buildCreativeStudioSnapshot();
  return [
    { id: 'creative-studio.dashboard.overview', method: 'GET', path: basePath, summary: createCreativeStudioRouteSummary(snapshot) },
    { id: 'creative-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'creative-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

