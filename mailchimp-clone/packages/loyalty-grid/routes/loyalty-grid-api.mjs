import { buildLoyaltyGridSnapshot, createLoyaltyGridApiDocument } from '../service-loyalty-grid.mjs';

export function createLoyaltyGridApiRoutes(basePath = '/api/loyalty-grid') {
  const snapshot = buildLoyaltyGridSnapshot();
  return [
    { id: 'loyalty-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-grid.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyGridApiDocument(snapshot) }
  ];
}

