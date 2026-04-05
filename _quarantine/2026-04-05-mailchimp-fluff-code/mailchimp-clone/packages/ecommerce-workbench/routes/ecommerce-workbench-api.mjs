import { buildEcommerceWorkbenchSnapshot, createEcommerceWorkbenchApiDocument } from '../service-ecommerce-workbench.mjs';

export function createEcommerceWorkbenchApiRoutes(basePath = '/api/ecommerce-workbench') {
  const snapshot = buildEcommerceWorkbenchSnapshot();
  return [
    { id: 'ecommerce-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-workbench.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceWorkbenchApiDocument(snapshot) }
  ];
}

