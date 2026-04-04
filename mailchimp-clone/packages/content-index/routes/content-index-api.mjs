import { buildContentIndexSnapshot, createContentIndexApiDocument } from '../service-content-index.mjs';

export function createContentIndexApiRoutes(basePath = '/api/content-index') {
  const snapshot = buildContentIndexSnapshot();
  return [
    { id: 'content-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-index.api.document', method: 'GET', path: basePath + '/document', document: createContentIndexApiDocument(snapshot) }
  ];
}

