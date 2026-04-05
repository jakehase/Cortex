import { buildCollaborationFoundrySnapshot, createCollaborationFoundryApiDocument } from '../service-collaboration-foundry.mjs';

export function createCollaborationFoundryApiRoutes(basePath = '/api/collaboration-foundry') {
  const snapshot = buildCollaborationFoundrySnapshot();
  return [
    { id: 'collaboration-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-foundry.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationFoundryApiDocument(snapshot) }
  ];
}

