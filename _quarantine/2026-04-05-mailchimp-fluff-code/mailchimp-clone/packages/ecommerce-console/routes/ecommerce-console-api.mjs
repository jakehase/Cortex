import { buildEcommerceConsoleSnapshot, createEcommerceConsoleApiDocument } from '../service-ecommerce-console.mjs';

export function createEcommerceConsoleApiRoutes(basePath = '/api/ecommerce-console') {
  const snapshot = buildEcommerceConsoleSnapshot();
  return [
    { id: 'ecommerce-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-console.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceConsoleApiDocument(snapshot) }
  ];
}

