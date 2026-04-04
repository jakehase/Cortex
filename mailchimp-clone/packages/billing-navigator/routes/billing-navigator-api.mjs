import { buildBillingNavigatorSnapshot, createBillingNavigatorApiDocument } from '../service-billing-navigator.mjs';

export function createBillingNavigatorApiRoutes(basePath = '/api/billing-navigator') {
  const snapshot = buildBillingNavigatorSnapshot();
  return [
    { id: 'billing-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-navigator.api.document', method: 'GET', path: basePath + '/document', document: createBillingNavigatorApiDocument(snapshot) }
  ];
}

