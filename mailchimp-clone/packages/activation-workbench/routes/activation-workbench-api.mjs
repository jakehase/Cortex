import { buildActivationWorkbenchSnapshot, createActivationWorkbenchApiDocument } from '../service-activation-workbench.mjs';

export function createActivationWorkbenchApiRoutes(basePath = '/api/activation-workbench') {
  const snapshot = buildActivationWorkbenchSnapshot();
  return [
    { id: 'activation-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-workbench.api.document', method: 'GET', path: basePath + '/document', document: createActivationWorkbenchApiDocument(snapshot) }
  ];
}

