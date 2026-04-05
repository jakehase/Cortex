import { buildLifecycleNavigatorSnapshot, createLifecycleNavigatorApiDocument } from '../service-lifecycle-navigator.mjs';

export function createLifecycleNavigatorApiRoutes(basePath = '/api/lifecycle-navigator') {
  const snapshot = buildLifecycleNavigatorSnapshot();
  return [
    { id: 'lifecycle-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-navigator.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleNavigatorApiDocument(snapshot) }
  ];
}

