import { buildAttributionWatchtowerSnapshot, createAttributionWatchtowerApiDocument } from '../service-attribution-watchtower.mjs';

export function createAttributionWatchtowerApiRoutes(basePath = '/api/attribution-watchtower') {
  const snapshot = buildAttributionWatchtowerSnapshot();
  return [
    { id: 'attribution-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createAttributionWatchtowerApiDocument(snapshot) }
  ];
}

