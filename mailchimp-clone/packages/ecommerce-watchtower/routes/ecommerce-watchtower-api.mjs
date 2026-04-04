import { buildEcommerceWatchtowerSnapshot, createEcommerceWatchtowerApiDocument } from '../service-ecommerce-watchtower.mjs';

export function createEcommerceWatchtowerApiRoutes(basePath = '/api/ecommerce-watchtower') {
  const snapshot = buildEcommerceWatchtowerSnapshot();
  return [
    { id: 'ecommerce-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceWatchtowerApiDocument(snapshot) }
  ];
}

