import { buildCommerceGridSnapshot, createCommerceGridApiDocument } from '../service-commerce-grid.mjs';

export function createCommerceGridApiRoutes(basePath = '/api/commerce-grid') {
  const snapshot = buildCommerceGridSnapshot();
  return [
    { id: 'commerce-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-grid.api.document', method: 'GET', path: basePath + '/document', document: createCommerceGridApiDocument(snapshot) }
  ];
}

