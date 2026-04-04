import { buildIntegrationsWorkbenchSnapshot, createIntegrationsWorkbenchApiDocument } from '../service-integrations-workbench.mjs';

export function createIntegrationsWorkbenchApiRoutes(basePath = '/api/integrations-workbench') {
  const snapshot = buildIntegrationsWorkbenchSnapshot();
  return [
    { id: 'integrations-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-workbench.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsWorkbenchApiDocument(snapshot) }
  ];
}

