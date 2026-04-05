import { buildCommerceExchangeSnapshot, createCommerceExchangeApiDocument } from '../service-commerce-exchange.mjs';

export function createCommerceExchangeApiRoutes(basePath = '/api/commerce-exchange') {
  const snapshot = buildCommerceExchangeSnapshot();
  return [
    { id: 'commerce-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-exchange.api.document', method: 'GET', path: basePath + '/document', document: createCommerceExchangeApiDocument(snapshot) }
  ];
}

