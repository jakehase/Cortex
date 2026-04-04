import { buildAdvocacyIndexSnapshot, createAdvocacyIndexApiDocument } from '../service-advocacy-index.mjs';

export function createAdvocacyIndexApiRoutes(basePath = '/api/advocacy-index') {
  const snapshot = buildAdvocacyIndexSnapshot();
  return [
    { id: 'advocacy-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-index.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyIndexApiDocument(snapshot) }
  ];
}

