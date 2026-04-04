import { buildCreativeExchangeSnapshot, createCreativeExchangeApiDocument } from '../service-creative-exchange.mjs';

export function createCreativeExchangeApiRoutes(basePath = '/api/creative-exchange') {
  const snapshot = buildCreativeExchangeSnapshot();
  return [
    { id: 'creative-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-exchange.api.document', method: 'GET', path: basePath + '/document', document: createCreativeExchangeApiDocument(snapshot) }
  ];
}

