import { buildEcommerceHubSnapshot, createEcommerceHubApiDocument } from '../service-ecommerce-hub.mjs';

export function createEcommerceHubApiRoutes(basePath = '/api/ecommerce-hub') {
  const snapshot = buildEcommerceHubSnapshot();
  return [
    { id: 'ecommerce-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-hub.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceHubApiDocument(snapshot) }
  ];
}

