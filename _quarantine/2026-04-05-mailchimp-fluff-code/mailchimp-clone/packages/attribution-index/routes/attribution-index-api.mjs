import { buildAttributionIndexSnapshot, createAttributionIndexApiDocument } from '../service-attribution-index.mjs';

export function createAttributionIndexApiRoutes(basePath = '/api/attribution-index') {
  const snapshot = buildAttributionIndexSnapshot();
  return [
    { id: 'attribution-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-index.api.document', method: 'GET', path: basePath + '/document', document: createAttributionIndexApiDocument(snapshot) }
  ];
}

