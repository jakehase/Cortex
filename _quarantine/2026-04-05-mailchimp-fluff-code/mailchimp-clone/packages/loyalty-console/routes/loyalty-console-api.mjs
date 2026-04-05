import { buildLoyaltyConsoleSnapshot, createLoyaltyConsoleApiDocument } from '../service-loyalty-console.mjs';

export function createLoyaltyConsoleApiRoutes(basePath = '/api/loyalty-console') {
  const snapshot = buildLoyaltyConsoleSnapshot();
  return [
    { id: 'loyalty-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-console.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyConsoleApiDocument(snapshot) }
  ];
}

