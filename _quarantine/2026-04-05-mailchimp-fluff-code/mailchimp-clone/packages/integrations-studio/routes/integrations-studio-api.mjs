import { buildIntegrationsStudioSnapshot, createIntegrationsStudioApiDocument } from '../service-integrations-studio.mjs';

export function createIntegrationsStudioApiRoutes(basePath = '/api/integrations-studio') {
  const snapshot = buildIntegrationsStudioSnapshot();
  return [
    { id: 'integrations-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-studio.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsStudioApiDocument(snapshot) }
  ];
}

