import { buildAdvocacyHubSnapshot, createAdvocacyHubApiDocument } from '../service-advocacy-hub.mjs';

export function createAdvocacyHubApiRoutes(basePath = '/api/advocacy-hub') {
  const snapshot = buildAdvocacyHubSnapshot();
  return [
    { id: 'advocacy-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-hub.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyHubApiDocument(snapshot) }
  ];
}

