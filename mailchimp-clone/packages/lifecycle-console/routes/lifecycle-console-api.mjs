import { buildLifecycleConsoleSnapshot, createLifecycleConsoleApiDocument } from '../service-lifecycle-console.mjs';

export function createLifecycleConsoleApiRoutes(basePath = '/api/lifecycle-console') {
  const snapshot = buildLifecycleConsoleSnapshot();
  return [
    { id: 'lifecycle-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-console.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleConsoleApiDocument(snapshot) }
  ];
}

