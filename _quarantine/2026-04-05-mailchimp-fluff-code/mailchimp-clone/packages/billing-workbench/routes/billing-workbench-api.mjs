import { buildBillingWorkbenchSnapshot, createBillingWorkbenchApiDocument } from '../service-billing-workbench.mjs';

export function createBillingWorkbenchApiRoutes(basePath = '/api/billing-workbench') {
  const snapshot = buildBillingWorkbenchSnapshot();
  return [
    { id: 'billing-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-workbench.api.document', method: 'GET', path: basePath + '/document', document: createBillingWorkbenchApiDocument(snapshot) }
  ];
}

