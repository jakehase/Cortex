import { buildEcommerceIndexSnapshot, createEcommerceIndexApiDocument } from '../service-ecommerce-index.mjs';

export function createEcommerceIndexApiRoutes(basePath = '/api/ecommerce-index') {
  const snapshot = buildEcommerceIndexSnapshot();
  return [
    { id: 'ecommerce-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-index.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceIndexApiDocument(snapshot) }
  ];
}

