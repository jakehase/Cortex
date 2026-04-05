import { buildCustomerSentinelSnapshot, createCustomerSentinelApiDocument } from '../service-customer-sentinel.mjs';

export function createCustomerSentinelApiRoutes(basePath = '/api/customer-sentinel') {
  const snapshot = buildCustomerSentinelSnapshot();
  return [
    { id: 'customer-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createCustomerSentinelApiDocument(snapshot) }
  ];
}

