import { buildCollaborationStudioSnapshot, createCollaborationStudioApiDocument } from '../service-collaboration-studio.mjs';

export function createCollaborationStudioApiRoutes(basePath = '/api/collaboration-studio') {
  const snapshot = buildCollaborationStudioSnapshot();
  return [
    { id: 'collaboration-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-studio.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationStudioApiDocument(snapshot) }
  ];
}

