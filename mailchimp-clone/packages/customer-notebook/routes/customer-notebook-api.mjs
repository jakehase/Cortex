import { buildCustomerNotebookSnapshot, createCustomerNotebookApiDocument } from '../service-customer-notebook.mjs';

export function createCustomerNotebookApiRoutes(basePath = '/api/customer-notebook') {
  const snapshot = buildCustomerNotebookSnapshot();
  return [
    { id: 'customer-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-notebook.api.document', method: 'GET', path: basePath + '/document', document: createCustomerNotebookApiDocument(snapshot) }
  ];
}

