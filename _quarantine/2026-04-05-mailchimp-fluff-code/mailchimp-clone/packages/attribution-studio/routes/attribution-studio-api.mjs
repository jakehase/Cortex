import { buildAttributionStudioSnapshot, createAttributionStudioApiDocument } from '../service-attribution-studio.mjs';

export function createAttributionStudioApiRoutes(basePath = '/api/attribution-studio') {
  const snapshot = buildAttributionStudioSnapshot();
  return [
    { id: 'attribution-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-studio.api.document', method: 'GET', path: basePath + '/document', document: createAttributionStudioApiDocument(snapshot) }
  ];
}

