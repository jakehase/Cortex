import { buildDataNavigatorSnapshot, createDataNavigatorApiDocument } from '../service-data-navigator.mjs';

export function createDataNavigatorApiRoutes(basePath = '/api/data-navigator') {
  const snapshot = buildDataNavigatorSnapshot();
  return [
    { id: 'data-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-navigator.api.document', method: 'GET', path: basePath + '/document', document: createDataNavigatorApiDocument(snapshot) }
  ];
}

