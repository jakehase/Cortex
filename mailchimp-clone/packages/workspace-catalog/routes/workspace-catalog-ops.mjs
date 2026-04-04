import { buildWorkspaceCatalogSnapshot, createWorkspaceCatalogChecklist } from '../service-workspace-catalog.mjs';

export function createWorkspaceCatalogOpsRoutes(basePath = '/ops/workspace-catalog') {
  const snapshot = buildWorkspaceCatalogSnapshot();
  return [
    { id: 'workspace-catalog.ops.health', method: 'GET', path: basePath + '/health', checklist: createWorkspaceCatalogChecklist(snapshot) },
    { id: 'workspace-catalog.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'workspace-catalog.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
