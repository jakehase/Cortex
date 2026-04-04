import { buildLifecycleGridSnapshot, createLifecycleGridApiDocument } from '../service-lifecycle-grid.mjs';

export function createLifecycleGridApiRoutes(basePath = '/api/lifecycle-grid') {
  const snapshot = buildLifecycleGridSnapshot();
  return [
    { id: 'lifecycle-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-grid.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleGridApiDocument(snapshot) }
  ];
}

