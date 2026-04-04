import { buildAudienceIndexSnapshot, createAudienceIndexApiDocument } from '../service-audience-index.mjs';

export function createAudienceIndexApiRoutes(basePath = '/api/audience-index') {
  const snapshot = buildAudienceIndexSnapshot();
  return [
    { id: 'audience-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-index.api.document', method: 'GET', path: basePath + '/document', document: createAudienceIndexApiDocument(snapshot) }
  ];
}

