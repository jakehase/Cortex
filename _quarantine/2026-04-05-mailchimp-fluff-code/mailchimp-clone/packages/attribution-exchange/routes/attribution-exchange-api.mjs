import { buildAttributionExchangeSnapshot, createAttributionExchangeApiDocument } from '../service-attribution-exchange.mjs';

export function createAttributionExchangeApiRoutes(basePath = '/api/attribution-exchange') {
  const snapshot = buildAttributionExchangeSnapshot();
  return [
    { id: 'attribution-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-exchange.api.document', method: 'GET', path: basePath + '/document', document: createAttributionExchangeApiDocument(snapshot) }
  ];
}

