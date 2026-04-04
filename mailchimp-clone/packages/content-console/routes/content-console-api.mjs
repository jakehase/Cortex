import { buildContentConsoleSnapshot, createContentConsoleApiDocument } from '../service-content-console.mjs';

export function createContentConsoleApiRoutes(basePath = '/api/content-console') {
  const snapshot = buildContentConsoleSnapshot();
  return [
    { id: 'content-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-console.api.document', method: 'GET', path: basePath + '/document', document: createContentConsoleApiDocument(snapshot) }
  ];
}

