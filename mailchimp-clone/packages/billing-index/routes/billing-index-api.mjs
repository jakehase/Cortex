import { buildBillingIndexSnapshot, createBillingIndexApiDocument } from '../service-billing-index.mjs';

export function createBillingIndexApiRoutes(basePath = '/api/billing-index') {
  const snapshot = buildBillingIndexSnapshot();
  return [
    { id: 'billing-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-index.api.document', method: 'GET', path: basePath + '/document', document: createBillingIndexApiDocument(snapshot) }
  ];
}

