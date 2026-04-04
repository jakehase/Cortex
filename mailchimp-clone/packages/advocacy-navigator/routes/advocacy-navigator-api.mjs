import { buildAdvocacyNavigatorSnapshot, createAdvocacyNavigatorApiDocument } from '../service-advocacy-navigator.mjs';

export function createAdvocacyNavigatorApiRoutes(basePath = '/api/advocacy-navigator') {
  const snapshot = buildAdvocacyNavigatorSnapshot();
  return [
    { id: 'advocacy-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-navigator.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyNavigatorApiDocument(snapshot) }
  ];
}

