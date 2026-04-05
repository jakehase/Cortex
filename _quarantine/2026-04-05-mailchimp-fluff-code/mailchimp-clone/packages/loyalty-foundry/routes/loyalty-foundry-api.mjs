import { buildLoyaltyFoundrySnapshot, createLoyaltyFoundryApiDocument } from '../service-loyalty-foundry.mjs';

export function createLoyaltyFoundryApiRoutes(basePath = '/api/loyalty-foundry') {
  const snapshot = buildLoyaltyFoundrySnapshot();
  return [
    { id: 'loyalty-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-foundry.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyFoundryApiDocument(snapshot) }
  ];
}

