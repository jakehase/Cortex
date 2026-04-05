import { buildEcommerceAtlasSnapshot, createEcommerceAtlasApiDocument } from '../service-ecommerce-atlas.mjs';

export function createEcommerceAtlasApiRoutes(basePath = '/api/ecommerce-atlas') {
  const snapshot = buildEcommerceAtlasSnapshot();
  return [
    { id: 'ecommerce-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-atlas.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceAtlasApiDocument(snapshot) }
  ];
}

