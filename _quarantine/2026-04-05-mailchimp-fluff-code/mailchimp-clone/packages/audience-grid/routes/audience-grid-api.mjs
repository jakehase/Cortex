import { buildAudienceGridSnapshot, createAudienceGridApiDocument } from '../service-audience-grid.mjs';

export function createAudienceGridApiRoutes(basePath = '/api/audience-grid') {
  const snapshot = buildAudienceGridSnapshot();
  return [
    { id: 'audience-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-grid.api.document', method: 'GET', path: basePath + '/document', document: createAudienceGridApiDocument(snapshot) }
  ];
}

