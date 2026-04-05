import { buildCreativeNotebookSnapshot, createCreativeNotebookApiDocument } from '../service-creative-notebook.mjs';

export function createCreativeNotebookApiRoutes(basePath = '/api/creative-notebook') {
  const snapshot = buildCreativeNotebookSnapshot();
  return [
    { id: 'creative-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-notebook.api.document', method: 'GET', path: basePath + '/document', document: createCreativeNotebookApiDocument(snapshot) }
  ];
}

