import { buildCustomerHubSnapshot, createCustomerHubApiDocument } from '../service-customer-hub.mjs';

export function createCustomerHubApiRoutes(basePath = '/api/customer-hub') {
  const snapshot = buildCustomerHubSnapshot();
  return [
    { id: 'customer-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-hub.api.document', method: 'GET', path: basePath + '/document', document: createCustomerHubApiDocument(snapshot) }
  ];
}

