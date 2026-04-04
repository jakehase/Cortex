import { buildDataAtlasSnapshot, createDataAtlasApiDocument } from '../service-data-atlas.mjs';

export function createDataAtlasApiRoutes(basePath = '/api/data-atlas') {
  const snapshot = buildDataAtlasSnapshot();
  return [
    { id: 'data-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-atlas.api.document', method: 'GET', path: basePath + '/document', document: createDataAtlasApiDocument(snapshot) }
  ];
}

