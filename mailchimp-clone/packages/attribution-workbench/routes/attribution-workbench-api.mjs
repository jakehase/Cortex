import { buildAttributionWorkbenchSnapshot, createAttributionWorkbenchApiDocument } from '../service-attribution-workbench.mjs';

export function createAttributionWorkbenchApiRoutes(basePath = '/api/attribution-workbench') {
  const snapshot = buildAttributionWorkbenchSnapshot();
  return [
    { id: 'attribution-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-workbench.api.document', method: 'GET', path: basePath + '/document', document: createAttributionWorkbenchApiDocument(snapshot) }
  ];
}

