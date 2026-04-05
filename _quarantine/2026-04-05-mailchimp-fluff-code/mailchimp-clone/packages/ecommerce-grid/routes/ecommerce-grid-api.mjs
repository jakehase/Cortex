import { buildEcommerceGridSnapshot, createEcommerceGridApiDocument } from '../service-ecommerce-grid.mjs';

export function createEcommerceGridApiRoutes(basePath = '/api/ecommerce-grid') {
  const snapshot = buildEcommerceGridSnapshot();
  return [
    { id: 'ecommerce-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-grid.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceGridApiDocument(snapshot) }
  ];
}

