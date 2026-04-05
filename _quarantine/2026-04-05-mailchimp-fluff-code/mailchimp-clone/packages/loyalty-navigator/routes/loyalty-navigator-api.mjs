import { buildLoyaltyNavigatorSnapshot, createLoyaltyNavigatorApiDocument } from '../service-loyalty-navigator.mjs';

export function createLoyaltyNavigatorApiRoutes(basePath = '/api/loyalty-navigator') {
  const snapshot = buildLoyaltyNavigatorSnapshot();
  return [
    { id: 'loyalty-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-navigator.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyNavigatorApiDocument(snapshot) }
  ];
}

