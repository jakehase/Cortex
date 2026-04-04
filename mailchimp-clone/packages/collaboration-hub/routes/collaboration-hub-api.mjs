import { buildCollaborationHubSnapshot, createCollaborationHubApiDocument } from '../service-collaboration-hub.mjs';

export function createCollaborationHubApiRoutes(basePath = '/api/collaboration-hub') {
  const snapshot = buildCollaborationHubSnapshot();
  return [
    { id: 'collaboration-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-hub.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationHubApiDocument(snapshot) }
  ];
}

