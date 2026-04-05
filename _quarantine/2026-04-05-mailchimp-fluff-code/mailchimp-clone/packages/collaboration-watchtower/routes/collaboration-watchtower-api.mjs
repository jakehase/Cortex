import { buildCollaborationWatchtowerSnapshot, createCollaborationWatchtowerApiDocument } from '../service-collaboration-watchtower.mjs';

export function createCollaborationWatchtowerApiRoutes(basePath = '/api/collaboration-watchtower') {
  const snapshot = buildCollaborationWatchtowerSnapshot();
  return [
    { id: 'collaboration-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationWatchtowerApiDocument(snapshot) }
  ];
}

