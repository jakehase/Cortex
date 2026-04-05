import { buildDataConsoleSnapshot, createDataConsoleApiDocument } from '../service-data-console.mjs';

export function createDataConsoleApiRoutes(basePath = '/api/data-console') {
  const snapshot = buildDataConsoleSnapshot();
  return [
    { id: 'data-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-console.api.document', method: 'GET', path: basePath + '/document', document: createDataConsoleApiDocument(snapshot) }
  ];
}

