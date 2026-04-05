import { buildCustomerExchangeSnapshot, createCustomerExchangeApiDocument } from '../service-customer-exchange.mjs';

export function createCustomerExchangeApiRoutes(basePath = '/api/customer-exchange') {
  const snapshot = buildCustomerExchangeSnapshot();
  return [
    { id: 'customer-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-exchange.api.document', method: 'GET', path: basePath + '/document', document: createCustomerExchangeApiDocument(snapshot) }
  ];
}

