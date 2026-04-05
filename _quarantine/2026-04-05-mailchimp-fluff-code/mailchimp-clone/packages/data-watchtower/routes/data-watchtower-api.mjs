import { buildDataWatchtowerSnapshot, createDataWatchtowerApiDocument } from '../service-data-watchtower.mjs';

export function createDataWatchtowerApiRoutes(basePath = '/api/data-watchtower') {
  const snapshot = buildDataWatchtowerSnapshot();
  return [
    { id: 'data-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createDataWatchtowerApiDocument(snapshot) }
  ];
}

