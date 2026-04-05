import { buildCustomerFoundrySnapshot, createCustomerFoundryApiDocument } from '../service-customer-foundry.mjs';

export function createCustomerFoundryApiRoutes(basePath = '/api/customer-foundry') {
  const snapshot = buildCustomerFoundrySnapshot();
  return [
    { id: 'customer-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-foundry.api.document', method: 'GET', path: basePath + '/document', document: createCustomerFoundryApiDocument(snapshot) }
  ];
}

