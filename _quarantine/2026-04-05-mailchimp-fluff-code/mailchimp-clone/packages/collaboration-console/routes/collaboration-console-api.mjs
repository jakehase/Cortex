import { buildCollaborationConsoleSnapshot, createCollaborationConsoleApiDocument } from '../service-collaboration-console.mjs';

export function createCollaborationConsoleApiRoutes(basePath = '/api/collaboration-console') {
  const snapshot = buildCollaborationConsoleSnapshot();
  return [
    { id: 'collaboration-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-console.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationConsoleApiDocument(snapshot) }
  ];
}

