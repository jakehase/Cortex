import { buildAdvocacyGridSnapshot, createAdvocacyGridApiDocument } from '../service-advocacy-grid.mjs';

export function createAdvocacyGridApiRoutes(basePath = '/api/advocacy-grid') {
  const snapshot = buildAdvocacyGridSnapshot();
  return [
    { id: 'advocacy-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-grid.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyGridApiDocument(snapshot) }
  ];
}

