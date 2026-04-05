import { buildAttributionNavigatorSnapshot, createAttributionNavigatorApiDocument } from '../service-attribution-navigator.mjs';

export function createAttributionNavigatorApiRoutes(basePath = '/api/attribution-navigator') {
  const snapshot = buildAttributionNavigatorSnapshot();
  return [
    { id: 'attribution-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-navigator.api.document', method: 'GET', path: basePath + '/document', document: createAttributionNavigatorApiDocument(snapshot) }
  ];
}

