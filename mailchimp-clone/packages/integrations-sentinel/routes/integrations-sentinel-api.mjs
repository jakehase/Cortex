import { buildIntegrationsSentinelSnapshot, createIntegrationsSentinelApiDocument } from '../service-integrations-sentinel.mjs';

export function createIntegrationsSentinelApiRoutes(basePath = '/api/integrations-sentinel') {
  const snapshot = buildIntegrationsSentinelSnapshot();
  return [
    { id: 'integrations-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsSentinelApiDocument(snapshot) }
  ];
}

