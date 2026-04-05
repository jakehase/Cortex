import { buildLoyaltyHubSnapshot, createLoyaltyHubApiDocument } from '../service-loyalty-hub.mjs';

export function createLoyaltyHubApiRoutes(basePath = '/api/loyalty-hub') {
  const snapshot = buildLoyaltyHubSnapshot();
  return [
    { id: 'loyalty-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-hub.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyHubApiDocument(snapshot) }
  ];
}

