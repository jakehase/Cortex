import { buildLifecycleNotebookSnapshot, createLifecycleNotebookApiDocument } from '../service-lifecycle-notebook.mjs';

export function createLifecycleNotebookApiRoutes(basePath = '/api/lifecycle-notebook') {
  const snapshot = buildLifecycleNotebookSnapshot();
  return [
    { id: 'lifecycle-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-notebook.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleNotebookApiDocument(snapshot) }
  ];
}

