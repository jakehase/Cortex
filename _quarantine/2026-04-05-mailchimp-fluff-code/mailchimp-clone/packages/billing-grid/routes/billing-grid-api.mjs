import { buildBillingGridSnapshot, createBillingGridApiDocument } from '../service-billing-grid.mjs';

export function createBillingGridApiRoutes(basePath = '/api/billing-grid') {
  const snapshot = buildBillingGridSnapshot();
  return [
    { id: 'billing-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-grid.api.document', method: 'GET', path: basePath + '/document', document: createBillingGridApiDocument(snapshot) }
  ];
}

