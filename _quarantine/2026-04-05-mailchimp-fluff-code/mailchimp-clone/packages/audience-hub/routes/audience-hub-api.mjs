import { buildAudienceHubSnapshot, createAudienceHubApiDocument } from '../service-audience-hub.mjs';

export function createAudienceHubApiRoutes(basePath = '/api/audience-hub') {
  const snapshot = buildAudienceHubSnapshot();
  return [
    { id: 'audience-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-hub.api.document', method: 'GET', path: basePath + '/document', document: createAudienceHubApiDocument(snapshot) }
  ];
}

