import { buildDataExchangeSnapshot, createDataExchangeApiDocument } from '../service-data-exchange.mjs';

export function createDataExchangeApiRoutes(basePath = '/api/data-exchange') {
  const snapshot = buildDataExchangeSnapshot();
  return [
    { id: 'data-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-exchange.api.document', method: 'GET', path: basePath + '/document', document: createDataExchangeApiDocument(snapshot) }
  ];
}

