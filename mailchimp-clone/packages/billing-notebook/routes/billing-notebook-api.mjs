import { buildBillingNotebookSnapshot, createBillingNotebookApiDocument } from '../service-billing-notebook.mjs';

export function createBillingNotebookApiRoutes(basePath = '/api/billing-notebook') {
  const snapshot = buildBillingNotebookSnapshot();
  return [
    { id: 'billing-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-notebook.api.document', method: 'GET', path: basePath + '/document', document: createBillingNotebookApiDocument(snapshot) }
  ];
}

