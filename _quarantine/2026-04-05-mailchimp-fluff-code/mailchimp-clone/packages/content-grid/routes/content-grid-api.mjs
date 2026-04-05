import { buildContentGridSnapshot, createContentGridApiDocument } from '../service-content-grid.mjs';

export function createContentGridApiRoutes(basePath = '/api/content-grid') {
  const snapshot = buildContentGridSnapshot();
  return [
    { id: 'content-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-grid.api.document', method: 'GET', path: basePath + '/document', document: createContentGridApiDocument(snapshot) }
  ];
}

