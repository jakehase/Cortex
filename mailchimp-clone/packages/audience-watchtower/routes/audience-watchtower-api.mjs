import { buildAudienceWatchtowerSnapshot, createAudienceWatchtowerApiDocument } from '../service-audience-watchtower.mjs';

export function createAudienceWatchtowerApiRoutes(basePath = '/api/audience-watchtower') {
  const snapshot = buildAudienceWatchtowerSnapshot();
  return [
    { id: 'audience-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createAudienceWatchtowerApiDocument(snapshot) }
  ];
}

