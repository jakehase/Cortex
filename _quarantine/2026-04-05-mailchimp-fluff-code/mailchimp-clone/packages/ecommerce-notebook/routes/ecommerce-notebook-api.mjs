import { buildEcommerceNotebookSnapshot, createEcommerceNotebookApiDocument } from '../service-ecommerce-notebook.mjs';

export function createEcommerceNotebookApiRoutes(basePath = '/api/ecommerce-notebook') {
  const snapshot = buildEcommerceNotebookSnapshot();
  return [
    { id: 'ecommerce-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-notebook.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceNotebookApiDocument(snapshot) }
  ];
}

