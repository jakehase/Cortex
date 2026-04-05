import { buildCustomerConsoleSnapshot, createCustomerConsoleApiDocument } from '../service-customer-console.mjs';

export function createCustomerConsoleApiRoutes(basePath = '/api/customer-console') {
  const snapshot = buildCustomerConsoleSnapshot();
  return [
    { id: 'customer-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-console.api.document', method: 'GET', path: basePath + '/document', document: createCustomerConsoleApiDocument(snapshot) }
  ];
}

