import { buildDataWorkbenchSnapshot, createDataWorkbenchApiDocument } from '../service-data-workbench.mjs';

export function createDataWorkbenchApiRoutes(basePath = '/api/data-workbench') {
  const snapshot = buildDataWorkbenchSnapshot();
  return [
    { id: 'data-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-workbench.api.document', method: 'GET', path: basePath + '/document', document: createDataWorkbenchApiDocument(snapshot) }
  ];
}

