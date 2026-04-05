import { buildDataHubSnapshot, createDataHubApiDocument } from '../service-data-hub.mjs';

export function createDataHubApiRoutes(basePath = '/api/data-hub') {
  const snapshot = buildDataHubSnapshot();
  return [
    { id: 'data-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-hub.api.document', method: 'GET', path: basePath + '/document', document: createDataHubApiDocument(snapshot) }
  ];
}

