import { buildLifecycleStudioSnapshot, createLifecycleStudioApiDocument } from '../service-lifecycle-studio.mjs';

export function createLifecycleStudioApiRoutes(basePath = '/api/lifecycle-studio') {
  const snapshot = buildLifecycleStudioSnapshot();
  return [
    { id: 'lifecycle-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-studio.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleStudioApiDocument(snapshot) }
  ];
}

