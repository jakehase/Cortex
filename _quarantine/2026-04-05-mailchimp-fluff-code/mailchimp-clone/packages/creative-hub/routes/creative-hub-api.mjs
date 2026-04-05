import { buildCreativeHubSnapshot, createCreativeHubApiDocument } from '../service-creative-hub.mjs';

export function createCreativeHubApiRoutes(basePath = '/api/creative-hub') {
  const snapshot = buildCreativeHubSnapshot();
  return [
    { id: 'creative-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-hub.api.document', method: 'GET', path: basePath + '/document', document: createCreativeHubApiDocument(snapshot) }
  ];
}

