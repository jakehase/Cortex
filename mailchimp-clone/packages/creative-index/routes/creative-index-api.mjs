import { buildCreativeIndexSnapshot, createCreativeIndexApiDocument } from '../service-creative-index.mjs';

export function createCreativeIndexApiRoutes(basePath = '/api/creative-index') {
  const snapshot = buildCreativeIndexSnapshot();
  return [
    { id: 'creative-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-index.api.document', method: 'GET', path: basePath + '/document', document: createCreativeIndexApiDocument(snapshot) }
  ];
}

