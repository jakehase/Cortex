import { buildCreativeGridSnapshot, createCreativeGridApiDocument } from '../service-creative-grid.mjs';

export function createCreativeGridApiRoutes(basePath = '/api/creative-grid') {
  const snapshot = buildCreativeGridSnapshot();
  return [
    { id: 'creative-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-grid.api.document', method: 'GET', path: basePath + '/document', document: createCreativeGridApiDocument(snapshot) }
  ];
}

