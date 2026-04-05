import { buildCustomerWatchtowerSnapshot, createCustomerWatchtowerApiDocument } from '../service-customer-watchtower.mjs';

export function createCustomerWatchtowerApiRoutes(basePath = '/api/customer-watchtower') {
  const snapshot = buildCustomerWatchtowerSnapshot();
  return [
    { id: 'customer-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createCustomerWatchtowerApiDocument(snapshot) }
  ];
}

