import { buildLoyaltyIndexSnapshot, createLoyaltyIndexApiDocument } from '../service-loyalty-index.mjs';

export function createLoyaltyIndexApiRoutes(basePath = '/api/loyalty-index') {
  const snapshot = buildLoyaltyIndexSnapshot();
  return [
    { id: 'loyalty-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-index.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyIndexApiDocument(snapshot) }
  ];
}

