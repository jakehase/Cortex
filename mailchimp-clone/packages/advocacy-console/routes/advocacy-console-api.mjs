import { buildAdvocacyConsoleSnapshot, createAdvocacyConsoleApiDocument } from '../service-advocacy-console.mjs';

export function createAdvocacyConsoleApiRoutes(basePath = '/api/advocacy-console') {
  const snapshot = buildAdvocacyConsoleSnapshot();
  return [
    { id: 'advocacy-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-console.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyConsoleApiDocument(snapshot) }
  ];
}

