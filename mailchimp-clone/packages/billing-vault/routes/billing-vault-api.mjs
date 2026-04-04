import { buildBillingVaultSnapshot, createBillingVaultApiDocument } from '../service-billing-vault.mjs';

export function createBillingVaultApiRoutes(basePath = '/api/billing-vault') {
  const snapshot = buildBillingVaultSnapshot();
  return [
    { id: 'billing-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-vault.api.document', method: 'GET', path: basePath + '/document', document: createBillingVaultApiDocument(snapshot) }
  ];
}

