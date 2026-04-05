import { buildContentNavigatorSnapshot, createContentNavigatorApiDocument } from '../service-content-navigator.mjs';

export function createContentNavigatorApiRoutes(basePath = '/api/content-navigator') {
  const snapshot = buildContentNavigatorSnapshot();
  return [
    { id: 'content-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-navigator.api.document', method: 'GET', path: basePath + '/document', document: createContentNavigatorApiDocument(snapshot) }
  ];
}

