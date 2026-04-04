import { buildAudienceAtlasSnapshot, createAudienceAtlasApiDocument } from '../service-audience-atlas.mjs';

export function createAudienceAtlasApiRoutes(basePath = '/api/audience-atlas') {
  const snapshot = buildAudienceAtlasSnapshot();
  return [
    { id: 'audience-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-atlas.api.document', method: 'GET', path: basePath + '/document', document: createAudienceAtlasApiDocument(snapshot) }
  ];
}

