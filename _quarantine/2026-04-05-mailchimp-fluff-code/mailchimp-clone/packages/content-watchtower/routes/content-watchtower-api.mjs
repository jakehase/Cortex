import { buildContentWatchtowerSnapshot, createContentWatchtowerApiDocument } from '../service-content-watchtower.mjs';

export function createContentWatchtowerApiRoutes(basePath = '/api/content-watchtower') {
  const snapshot = buildContentWatchtowerSnapshot();
  return [
    { id: 'content-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createContentWatchtowerApiDocument(snapshot) }
  ];
}

