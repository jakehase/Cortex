import { buildBillingStudioSnapshot, createBillingStudioApiDocument } from '../service-billing-studio.mjs';

export function createBillingStudioApiRoutes(basePath = '/api/billing-studio') {
  const snapshot = buildBillingStudioSnapshot();
  return [
    { id: 'billing-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-studio.api.document', method: 'GET', path: basePath + '/document', document: createBillingStudioApiDocument(snapshot) }
  ];
}

