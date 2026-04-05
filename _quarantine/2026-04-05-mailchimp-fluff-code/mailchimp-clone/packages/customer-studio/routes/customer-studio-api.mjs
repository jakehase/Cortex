import { buildCustomerStudioSnapshot, createCustomerStudioApiDocument } from '../service-customer-studio.mjs';

export function createCustomerStudioApiRoutes(basePath = '/api/customer-studio') {
  const snapshot = buildCustomerStudioSnapshot();
  return [
    { id: 'customer-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-studio.api.document', method: 'GET', path: basePath + '/document', document: createCustomerStudioApiDocument(snapshot) }
  ];
}

