import { buildBillingWatchtowerSnapshot, createBillingWatchtowerApiDocument } from '../service-billing-watchtower.mjs';

export function createBillingWatchtowerApiRoutes(basePath = '/api/billing-watchtower') {
  const snapshot = buildBillingWatchtowerSnapshot();
  return [
    { id: 'billing-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createBillingWatchtowerApiDocument(snapshot) }
  ];
}

