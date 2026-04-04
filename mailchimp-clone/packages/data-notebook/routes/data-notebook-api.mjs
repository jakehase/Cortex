import { buildDataNotebookSnapshot, createDataNotebookApiDocument } from '../service-data-notebook.mjs';

export function createDataNotebookApiRoutes(basePath = '/api/data-notebook') {
  const snapshot = buildDataNotebookSnapshot();
  return [
    { id: 'data-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-notebook.api.document', method: 'GET', path: basePath + '/document', document: createDataNotebookApiDocument(snapshot) }
  ];
}

