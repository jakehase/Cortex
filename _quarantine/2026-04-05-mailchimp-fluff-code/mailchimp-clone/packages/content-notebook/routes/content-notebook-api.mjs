import { buildContentNotebookSnapshot, createContentNotebookApiDocument } from '../service-content-notebook.mjs';

export function createContentNotebookApiRoutes(basePath = '/api/content-notebook') {
  const snapshot = buildContentNotebookSnapshot();
  return [
    { id: 'content-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-notebook.api.document', method: 'GET', path: basePath + '/document', document: createContentNotebookApiDocument(snapshot) }
  ];
}

