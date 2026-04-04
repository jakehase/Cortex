import { buildCommerceNotebookSnapshot, createCommerceNotebookApiDocument } from '../service-commerce-notebook.mjs';

export function createCommerceNotebookApiRoutes(basePath = '/api/commerce-notebook') {
  const snapshot = buildCommerceNotebookSnapshot();
  return [
    { id: 'commerce-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-notebook.api.document', method: 'GET', path: basePath + '/document', document: createCommerceNotebookApiDocument(snapshot) }
  ];
}

