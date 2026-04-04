import { buildLoyaltyWatchtowerSnapshot, createLoyaltyWatchtowerApiDocument } from '../service-loyalty-watchtower.mjs';

export function createLoyaltyWatchtowerApiRoutes(basePath = '/api/loyalty-watchtower') {
  const snapshot = buildLoyaltyWatchtowerSnapshot();
  return [
    { id: 'loyalty-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyWatchtowerApiDocument(snapshot) }
  ];
}

