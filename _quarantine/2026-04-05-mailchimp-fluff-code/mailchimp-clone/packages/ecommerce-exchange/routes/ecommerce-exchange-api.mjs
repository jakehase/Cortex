import { buildEcommerceExchangeSnapshot, createEcommerceExchangeApiDocument } from '../service-ecommerce-exchange.mjs';

export function createEcommerceExchangeApiRoutes(basePath = '/api/ecommerce-exchange') {
  const snapshot = buildEcommerceExchangeSnapshot();
  return [
    { id: 'ecommerce-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-exchange.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceExchangeApiDocument(snapshot) }
  ];
}

