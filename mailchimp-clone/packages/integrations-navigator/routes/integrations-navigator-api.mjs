import { buildIntegrationsNavigatorSnapshot, createIntegrationsNavigatorApiDocument } from '../service-integrations-navigator.mjs';

export function createIntegrationsNavigatorApiRoutes(basePath = '/api/integrations-navigator') {
  const snapshot = buildIntegrationsNavigatorSnapshot();
  return [
    { id: 'integrations-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-navigator.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsNavigatorApiDocument(snapshot) }
  ];
}

