import { buildCollaborationAtlasSnapshot, createCollaborationAtlasApiDocument } from '../service-collaboration-atlas.mjs';

export function createCollaborationAtlasApiRoutes(basePath = '/api/collaboration-atlas') {
  const snapshot = buildCollaborationAtlasSnapshot();
  return [
    { id: 'collaboration-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-atlas.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationAtlasApiDocument(snapshot) }
  ];
}

