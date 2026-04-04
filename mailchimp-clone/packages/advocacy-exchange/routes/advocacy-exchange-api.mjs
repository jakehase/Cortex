import { buildAdvocacyExchangeSnapshot, createAdvocacyExchangeApiDocument } from '../service-advocacy-exchange.mjs';

export function createAdvocacyExchangeApiRoutes(basePath = '/api/advocacy-exchange') {
  const snapshot = buildAdvocacyExchangeSnapshot();
  return [
    { id: 'advocacy-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-exchange.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyExchangeApiDocument(snapshot) }
  ];
}

