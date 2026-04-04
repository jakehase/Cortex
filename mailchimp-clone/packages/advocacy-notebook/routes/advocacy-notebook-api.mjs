import { buildAdvocacyNotebookSnapshot, createAdvocacyNotebookApiDocument } from '../service-advocacy-notebook.mjs';

export function createAdvocacyNotebookApiRoutes(basePath = '/api/advocacy-notebook') {
  const snapshot = buildAdvocacyNotebookSnapshot();
  return [
    { id: 'advocacy-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-notebook.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyNotebookApiDocument(snapshot) }
  ];
}

