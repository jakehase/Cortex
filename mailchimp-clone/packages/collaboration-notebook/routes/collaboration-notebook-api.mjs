import { buildCollaborationNotebookSnapshot, createCollaborationNotebookApiDocument } from '../service-collaboration-notebook.mjs';

export function createCollaborationNotebookApiRoutes(basePath = '/api/collaboration-notebook') {
  const snapshot = buildCollaborationNotebookSnapshot();
  return [
    { id: 'collaboration-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-notebook.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationNotebookApiDocument(snapshot) }
  ];
}

