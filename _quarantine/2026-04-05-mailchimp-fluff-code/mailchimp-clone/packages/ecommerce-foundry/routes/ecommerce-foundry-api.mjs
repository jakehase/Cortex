import { buildEcommerceFoundrySnapshot, createEcommerceFoundryApiDocument } from '../service-ecommerce-foundry.mjs';

export function createEcommerceFoundryApiRoutes(basePath = '/api/ecommerce-foundry') {
  const snapshot = buildEcommerceFoundrySnapshot();
  return [
    { id: 'ecommerce-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-foundry.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceFoundryApiDocument(snapshot) }
  ];
}

