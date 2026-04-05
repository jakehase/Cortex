import { buildCreativeAtlasSnapshot, createCreativeAtlasApiDocument } from '../service-creative-atlas.mjs';

export function createCreativeAtlasApiRoutes(basePath = '/api/creative-atlas') {
  const snapshot = buildCreativeAtlasSnapshot();
  return [
    { id: 'creative-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-atlas.api.document', method: 'GET', path: basePath + '/document', document: createCreativeAtlasApiDocument(snapshot) }
  ];
}

