import { buildAdvocacyAtlasSnapshot, createAdvocacyAtlasApiDocument } from '../service-advocacy-atlas.mjs';

export function createAdvocacyAtlasApiRoutes(basePath = '/api/advocacy-atlas') {
  const snapshot = buildAdvocacyAtlasSnapshot();
  return [
    { id: 'advocacy-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-atlas.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyAtlasApiDocument(snapshot) }
  ];
}

