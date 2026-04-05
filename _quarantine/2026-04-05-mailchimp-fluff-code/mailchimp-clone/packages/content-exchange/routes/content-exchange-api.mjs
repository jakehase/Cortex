import { buildContentExchangeSnapshot, createContentExchangeApiDocument } from '../service-content-exchange.mjs';

export function createContentExchangeApiRoutes(basePath = '/api/content-exchange') {
  const snapshot = buildContentExchangeSnapshot();
  return [
    { id: 'content-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-exchange.api.document', method: 'GET', path: basePath + '/document', document: createContentExchangeApiDocument(snapshot) }
  ];
}

