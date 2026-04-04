import { buildIntegrationsHubSnapshot, createIntegrationsHubApiDocument } from '../service-integrations-hub.mjs';

export function createIntegrationsHubApiRoutes(basePath = '/api/integrations-hub') {
  const snapshot = buildIntegrationsHubSnapshot();
  return [
    { id: 'integrations-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-hub.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsHubApiDocument(snapshot) }
  ];
}

