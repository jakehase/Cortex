import { buildLifecycleWorkbenchSnapshot, createLifecycleWorkbenchApiDocument } from '../service-lifecycle-workbench.mjs';

export function createLifecycleWorkbenchApiRoutes(basePath = '/api/lifecycle-workbench') {
  const snapshot = buildLifecycleWorkbenchSnapshot();
  return [
    { id: 'lifecycle-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-workbench.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleWorkbenchApiDocument(snapshot) }
  ];
}

