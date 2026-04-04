import { buildContentAtlasSnapshot, createContentAtlasApiDocument } from '../service-content-atlas.mjs';

export function createContentAtlasApiRoutes(basePath = '/api/content-atlas') {
  const snapshot = buildContentAtlasSnapshot();
  return [
    { id: 'content-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-atlas.api.document', method: 'GET', path: basePath + '/document', document: createContentAtlasApiDocument(snapshot) }
  ];
}

