import { buildCollaborationIndexSnapshot, createCollaborationIndexApiDocument } from '../service-collaboration-index.mjs';

export function createCollaborationIndexApiRoutes(basePath = '/api/collaboration-index') {
  const snapshot = buildCollaborationIndexSnapshot();
  return [
    { id: 'collaboration-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-index.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationIndexApiDocument(snapshot) }
  ];
}

