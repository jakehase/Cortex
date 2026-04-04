import { buildAttributionHubSnapshot, createAttributionHubApiDocument } from '../service-attribution-hub.mjs';

export function createAttributionHubApiRoutes(basePath = '/api/attribution-hub') {
  const snapshot = buildAttributionHubSnapshot();
  return [
    { id: 'attribution-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-hub.api.document', method: 'GET', path: basePath + '/document', document: createAttributionHubApiDocument(snapshot) }
  ];
}

