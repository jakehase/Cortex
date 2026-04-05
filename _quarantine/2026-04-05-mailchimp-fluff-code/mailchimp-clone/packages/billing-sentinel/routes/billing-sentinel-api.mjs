import { buildBillingSentinelSnapshot, createBillingSentinelApiDocument } from '../service-billing-sentinel.mjs';

export function createBillingSentinelApiRoutes(basePath = '/api/billing-sentinel') {
  const snapshot = buildBillingSentinelSnapshot();
  return [
    { id: 'billing-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createBillingSentinelApiDocument(snapshot) }
  ];
}

