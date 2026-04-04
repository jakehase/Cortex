import { buildWorkspaceCatalogSnapshot, createWorkspaceCatalogApiDocument } from '../service-workspace-catalog.mjs';

export function createWorkspaceCatalogApiRoutes(basePath = '/api/workspace-catalog') {
  const snapshot = buildWorkspaceCatalogSnapshot();
  return [
    { id: 'workspace-catalog.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'workspace-catalog.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'workspace-catalog.api.document', method: 'GET', path: basePath + '/document', document: createWorkspaceCatalogApiDocument(snapshot) }
  ];
}
