import { buildCustomerIndexSnapshot, createCustomerIndexApiDocument } from '../service-customer-index.mjs';

export function createCustomerIndexApiRoutes(basePath = '/api/customer-index') {
  const snapshot = buildCustomerIndexSnapshot();
  return [
    { id: 'customer-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-index.api.document', method: 'GET', path: basePath + '/document', document: createCustomerIndexApiDocument(snapshot) }
  ];
}

