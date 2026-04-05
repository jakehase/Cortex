import { buildIntegrationsExchangeSnapshot, createIntegrationsExchangeApiDocument } from '../service-integrations-exchange.mjs';

export function createIntegrationsExchangeApiRoutes(basePath = '/api/integrations-exchange') {
  const snapshot = buildIntegrationsExchangeSnapshot();
  return [
    { id: 'integrations-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-exchange.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsExchangeApiDocument(snapshot) }
  ];
}

