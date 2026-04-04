import { buildCustomerNavigatorSnapshot, createCustomerNavigatorApiDocument } from '../service-customer-navigator.mjs';

export function createCustomerNavigatorApiRoutes(basePath = '/api/customer-navigator') {
  const snapshot = buildCustomerNavigatorSnapshot();
  return [
    { id: 'customer-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-navigator.api.document', method: 'GET', path: basePath + '/document', document: createCustomerNavigatorApiDocument(snapshot) }
  ];
}

