import { buildAudienceNavigatorSnapshot, createAudienceNavigatorApiDocument } from '../service-audience-navigator.mjs';

export function createAudienceNavigatorApiRoutes(basePath = '/api/audience-navigator') {
  const snapshot = buildAudienceNavigatorSnapshot();
  return [
    { id: 'audience-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-navigator.api.document', method: 'GET', path: basePath + '/document', document: createAudienceNavigatorApiDocument(snapshot) }
  ];
}

