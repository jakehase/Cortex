import { buildCollaborationWorkbenchSnapshot, createCollaborationWorkbenchApiDocument } from '../service-collaboration-workbench.mjs';

export function createCollaborationWorkbenchApiRoutes(basePath = '/api/collaboration-workbench') {
  const snapshot = buildCollaborationWorkbenchSnapshot();
  return [
    { id: 'collaboration-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-workbench.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationWorkbenchApiDocument(snapshot) }
  ];
}

