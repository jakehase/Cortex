import { buildLoyaltyStudioSnapshot, createLoyaltyStudioApiDocument } from '../service-loyalty-studio.mjs';

export function createLoyaltyStudioApiRoutes(basePath = '/api/loyalty-studio') {
  const snapshot = buildLoyaltyStudioSnapshot();
  return [
    { id: 'loyalty-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-studio.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyStudioApiDocument(snapshot) }
  ];
}

