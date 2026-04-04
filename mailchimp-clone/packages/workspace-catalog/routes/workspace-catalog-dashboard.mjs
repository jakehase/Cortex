import { buildWorkspaceCatalogSnapshot } from '../service-workspace-catalog.mjs';

export function createWorkspaceCatalogDashboardRoutes(basePath = '/workspace-catalog') {
  const snapshot = buildWorkspaceCatalogSnapshot();
  return [
    { id: 'workspace-catalog.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'workspace-catalog.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'workspace-catalog.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
