import { buildBillingConsoleSnapshot, createBillingConsoleApiDocument } from '../service-billing-console.mjs';

export function createBillingConsoleApiRoutes(basePath = '/api/billing-console') {
  const snapshot = buildBillingConsoleSnapshot();
  return [
    { id: 'billing-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-console.api.document', method: 'GET', path: basePath + '/document', document: createBillingConsoleApiDocument(snapshot) }
  ];
}

