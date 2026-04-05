import { buildLifecycleIndexSnapshot, createLifecycleIndexApiDocument } from '../service-lifecycle-index.mjs';

export function createLifecycleIndexApiRoutes(basePath = '/api/lifecycle-index') {
  const snapshot = buildLifecycleIndexSnapshot();
  return [
    { id: 'lifecycle-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-index.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleIndexApiDocument(snapshot) }
  ];
}

