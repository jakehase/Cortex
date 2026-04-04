import { buildCustomerGridSnapshot, createCustomerGridApiDocument } from '../service-customer-grid.mjs';

export function createCustomerGridApiRoutes(basePath = '/api/customer-grid') {
  const snapshot = buildCustomerGridSnapshot();
  return [
    { id: 'customer-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-grid.api.document', method: 'GET', path: basePath + '/document', document: createCustomerGridApiDocument(snapshot) }
  ];
}

