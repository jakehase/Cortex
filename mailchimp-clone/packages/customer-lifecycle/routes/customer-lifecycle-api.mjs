import { buildCustomerLifecycleSnapshot, createCustomerLifecycleApiDocument } from '../service-customer-lifecycle.mjs';

export function createCustomerLifecycleApiRoutes(basePath = '/api/customer-lifecycle') {
  const snapshot = buildCustomerLifecycleSnapshot();
  return [
    { id: 'customer-lifecycle.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-lifecycle.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-lifecycle.api.document', method: 'GET', path: basePath + '/document', document: createCustomerLifecycleApiDocument(snapshot) }
  ];
}
