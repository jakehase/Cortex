import { buildIntegrationsConsoleSnapshot, createIntegrationsConsoleApiDocument } from '../service-integrations-console.mjs';

export function createIntegrationsConsoleApiRoutes(basePath = '/api/integrations-console') {
  const snapshot = buildIntegrationsConsoleSnapshot();
  return [
    { id: 'integrations-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-console.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsConsoleApiDocument(snapshot) }
  ];
}

