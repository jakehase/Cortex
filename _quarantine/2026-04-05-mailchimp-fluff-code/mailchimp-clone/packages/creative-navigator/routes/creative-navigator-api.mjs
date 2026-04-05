import { buildCreativeNavigatorSnapshot, createCreativeNavigatorApiDocument } from '../service-creative-navigator.mjs';

export function createCreativeNavigatorApiRoutes(basePath = '/api/creative-navigator') {
  const snapshot = buildCreativeNavigatorSnapshot();
  return [
    { id: 'creative-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-navigator.api.document', method: 'GET', path: basePath + '/document', document: createCreativeNavigatorApiDocument(snapshot) }
  ];
}

