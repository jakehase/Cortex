import { buildCollaborationGridSnapshot, createCollaborationGridApiDocument } from '../service-collaboration-grid.mjs';

export function createCollaborationGridApiRoutes(basePath = '/api/collaboration-grid') {
  const snapshot = buildCollaborationGridSnapshot();
  return [
    { id: 'collaboration-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-grid.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationGridApiDocument(snapshot) }
  ];
}

