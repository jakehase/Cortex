import { buildAdvocacyWatchtowerSnapshot, createAdvocacyWatchtowerApiDocument } from '../service-advocacy-watchtower.mjs';

export function createAdvocacyWatchtowerApiRoutes(basePath = '/api/advocacy-watchtower') {
  const snapshot = buildAdvocacyWatchtowerSnapshot();
  return [
    { id: 'advocacy-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyWatchtowerApiDocument(snapshot) }
  ];
}

