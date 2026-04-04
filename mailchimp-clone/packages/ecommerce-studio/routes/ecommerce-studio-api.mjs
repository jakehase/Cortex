import { buildEcommerceStudioSnapshot, createEcommerceStudioApiDocument } from '../service-ecommerce-studio.mjs';

export function createEcommerceStudioApiRoutes(basePath = '/api/ecommerce-studio') {
  const snapshot = buildEcommerceStudioSnapshot();
  return [
    { id: 'ecommerce-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-studio.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceStudioApiDocument(snapshot) }
  ];
}

