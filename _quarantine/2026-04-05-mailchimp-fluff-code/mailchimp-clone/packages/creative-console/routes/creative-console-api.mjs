import { buildCreativeConsoleSnapshot, createCreativeConsoleApiDocument } from '../service-creative-console.mjs';

export function createCreativeConsoleApiRoutes(basePath = '/api/creative-console') {
  const snapshot = buildCreativeConsoleSnapshot();
  return [
    { id: 'creative-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-console.api.document', method: 'GET', path: basePath + '/document', document: createCreativeConsoleApiDocument(snapshot) }
  ];
}

