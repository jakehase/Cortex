import { buildCustomerWorkbenchSnapshot, createCustomerWorkbenchApiDocument } from '../service-customer-workbench.mjs';

export function createCustomerWorkbenchApiRoutes(basePath = '/api/customer-workbench') {
  const snapshot = buildCustomerWorkbenchSnapshot();
  return [
    { id: 'customer-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-workbench.api.document', method: 'GET', path: basePath + '/document', document: createCustomerWorkbenchApiDocument(snapshot) }
  ];
}

