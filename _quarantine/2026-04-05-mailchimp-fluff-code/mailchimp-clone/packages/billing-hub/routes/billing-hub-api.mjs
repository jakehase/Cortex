import { buildBillingHubSnapshot, createBillingHubApiDocument } from '../service-billing-hub.mjs';

export function createBillingHubApiRoutes(basePath = '/api/billing-hub') {
  const snapshot = buildBillingHubSnapshot();
  return [
    { id: 'billing-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-hub.api.document', method: 'GET', path: basePath + '/document', document: createBillingHubApiDocument(snapshot) }
  ];
}

