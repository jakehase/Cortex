import { buildAdvocacyWorkbenchSnapshot, createAdvocacyWorkbenchApiDocument } from '../service-advocacy-workbench.mjs';

export function createAdvocacyWorkbenchApiRoutes(basePath = '/api/advocacy-workbench') {
  const snapshot = buildAdvocacyWorkbenchSnapshot();
  return [
    { id: 'advocacy-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-workbench.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyWorkbenchApiDocument(snapshot) }
  ];
}

