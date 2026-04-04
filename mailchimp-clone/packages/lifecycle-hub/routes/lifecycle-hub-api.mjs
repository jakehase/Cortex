import { buildLifecycleHubSnapshot, createLifecycleHubApiDocument } from '../service-lifecycle-hub.mjs';

export function createLifecycleHubApiRoutes(basePath = '/api/lifecycle-hub') {
  const snapshot = buildLifecycleHubSnapshot();
  return [
    { id: 'lifecycle-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-hub.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleHubApiDocument(snapshot) }
  ];
}

