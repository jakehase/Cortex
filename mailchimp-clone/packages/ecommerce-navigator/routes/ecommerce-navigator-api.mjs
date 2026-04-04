import { buildEcommerceNavigatorSnapshot, createEcommerceNavigatorApiDocument } from '../service-ecommerce-navigator.mjs';

export function createEcommerceNavigatorApiRoutes(basePath = '/api/ecommerce-navigator') {
  const snapshot = buildEcommerceNavigatorSnapshot();
  return [
    { id: 'ecommerce-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-navigator.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceNavigatorApiDocument(snapshot) }
  ];
}

