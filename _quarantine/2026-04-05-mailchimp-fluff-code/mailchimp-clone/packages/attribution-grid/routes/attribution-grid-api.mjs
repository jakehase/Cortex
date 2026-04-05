import { buildAttributionGridSnapshot, createAttributionGridApiDocument } from '../service-attribution-grid.mjs';

export function createAttributionGridApiRoutes(basePath = '/api/attribution-grid') {
  const snapshot = buildAttributionGridSnapshot();
  return [
    { id: 'attribution-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-grid.api.document', method: 'GET', path: basePath + '/document', document: createAttributionGridApiDocument(snapshot) }
  ];
}

