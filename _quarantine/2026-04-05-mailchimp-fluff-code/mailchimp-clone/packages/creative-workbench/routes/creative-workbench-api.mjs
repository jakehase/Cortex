import { buildCreativeWorkbenchSnapshot, createCreativeWorkbenchApiDocument } from '../service-creative-workbench.mjs';

export function createCreativeWorkbenchApiRoutes(basePath = '/api/creative-workbench') {
  const snapshot = buildCreativeWorkbenchSnapshot();
  return [
    { id: 'creative-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-workbench.api.document', method: 'GET', path: basePath + '/document', document: createCreativeWorkbenchApiDocument(snapshot) }
  ];
}

