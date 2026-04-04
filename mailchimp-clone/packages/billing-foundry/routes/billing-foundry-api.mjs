import { buildBillingFoundrySnapshot, createBillingFoundryApiDocument } from '../service-billing-foundry.mjs';

export function createBillingFoundryApiRoutes(basePath = '/api/billing-foundry') {
  const snapshot = buildBillingFoundrySnapshot();
  return [
    { id: 'billing-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-foundry.api.document', method: 'GET', path: basePath + '/document', document: createBillingFoundryApiDocument(snapshot) }
  ];
}

