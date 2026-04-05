import { buildIntegrationsIndexSnapshot, createIntegrationsIndexApiDocument } from '../service-integrations-index.mjs';

export function createIntegrationsIndexApiRoutes(basePath = '/api/integrations-index') {
  const snapshot = buildIntegrationsIndexSnapshot();
  return [
    { id: 'integrations-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-index.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsIndexApiDocument(snapshot) }
  ];
}

