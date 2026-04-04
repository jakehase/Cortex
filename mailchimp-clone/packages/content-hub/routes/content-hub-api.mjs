import { buildContentHubSnapshot, createContentHubApiDocument } from '../service-content-hub.mjs';

export function createContentHubApiRoutes(basePath = '/api/content-hub') {
  const snapshot = buildContentHubSnapshot();
  return [
    { id: 'content-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-hub.api.document', method: 'GET', path: basePath + '/document', document: createContentHubApiDocument(snapshot) }
  ];
}

