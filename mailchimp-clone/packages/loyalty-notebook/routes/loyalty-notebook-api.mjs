import { buildLoyaltyNotebookSnapshot, createLoyaltyNotebookApiDocument } from '../service-loyalty-notebook.mjs';

export function createLoyaltyNotebookApiRoutes(basePath = '/api/loyalty-notebook') {
  const snapshot = buildLoyaltyNotebookSnapshot();
  return [
    { id: 'loyalty-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-notebook.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyNotebookApiDocument(snapshot) }
  ];
}

