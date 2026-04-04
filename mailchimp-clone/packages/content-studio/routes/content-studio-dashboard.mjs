import { buildContentStudioSnapshot, createContentStudioRouteSummary } from '../service-content-studio.mjs';

export function createContentStudioDashboardRoutes(basePath = '/content-studio') {
  const snapshot = buildContentStudioSnapshot();
  return [
    { id: 'content-studio.dashboard.overview', method: 'GET', path: basePath, summary: createContentStudioRouteSummary(snapshot) },
    { id: 'content-studio.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'content-studio.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

