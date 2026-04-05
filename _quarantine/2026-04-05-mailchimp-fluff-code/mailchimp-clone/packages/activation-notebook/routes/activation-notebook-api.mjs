import { buildActivationNotebookSnapshot, createActivationNotebookApiDocument } from '../service-activation-notebook.mjs';

export function createActivationNotebookApiRoutes(basePath = '/api/activation-notebook') {
  const snapshot = buildActivationNotebookSnapshot();
  return [
    { id: 'activation-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-notebook.api.document', method: 'GET', path: basePath + '/document', document: createActivationNotebookApiDocument(snapshot) }
  ];
}

