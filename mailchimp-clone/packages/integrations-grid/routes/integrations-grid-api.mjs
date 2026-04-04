import { buildIntegrationsGridSnapshot, createIntegrationsGridApiDocument } from '../service-integrations-grid.mjs';

export function createIntegrationsGridApiRoutes(basePath = '/api/integrations-grid') {
  const snapshot = buildIntegrationsGridSnapshot();
  return [
    { id: 'integrations-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-grid.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsGridApiDocument(snapshot) }
  ];
}

