import { buildLoyaltyVaultSnapshot, createLoyaltyVaultApiDocument } from '../service-loyalty-vault.mjs';

export function createLoyaltyVaultApiRoutes(basePath = '/api/loyalty-vault') {
  const snapshot = buildLoyaltyVaultSnapshot();
  return [
    { id: 'loyalty-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-vault.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyVaultApiDocument(snapshot) }
  ];
}

