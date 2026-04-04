import { buildLifecycleFoundrySnapshot, createLifecycleFoundryApiDocument } from '../service-lifecycle-foundry.mjs';

export function createLifecycleFoundryApiRoutes(basePath = '/api/lifecycle-foundry') {
  const snapshot = buildLifecycleFoundrySnapshot();
  return [
    { id: 'lifecycle-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-foundry.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleFoundryApiDocument(snapshot) }
  ];
}

