import { buildCreativeWatchtowerSnapshot, createCreativeWatchtowerApiDocument } from '../service-creative-watchtower.mjs';

export function createCreativeWatchtowerApiRoutes(basePath = '/api/creative-watchtower') {
  const snapshot = buildCreativeWatchtowerSnapshot();
  return [
    { id: 'creative-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createCreativeWatchtowerApiDocument(snapshot) }
  ];
}

