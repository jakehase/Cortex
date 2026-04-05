import { buildDataIndexSnapshot, createDataIndexApiDocument } from '../service-data-index.mjs';

export function createDataIndexApiRoutes(basePath = '/api/data-index') {
  const snapshot = buildDataIndexSnapshot();
  return [
    { id: 'data-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-index.api.document', method: 'GET', path: basePath + '/document', document: createDataIndexApiDocument(snapshot) }
  ];
}

