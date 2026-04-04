import { buildCollaborationNavigatorSnapshot, createCollaborationNavigatorApiDocument } from '../service-collaboration-navigator.mjs';

export function createCollaborationNavigatorApiRoutes(basePath = '/api/collaboration-navigator') {
  const snapshot = buildCollaborationNavigatorSnapshot();
  return [
    { id: 'collaboration-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-navigator.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationNavigatorApiDocument(snapshot) }
  ];
}

