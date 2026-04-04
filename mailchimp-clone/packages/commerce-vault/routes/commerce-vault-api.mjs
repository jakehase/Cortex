import { buildCommerceVaultSnapshot, createCommerceVaultApiDocument } from '../service-commerce-vault.mjs';

export function createCommerceVaultApiRoutes(basePath = '/api/commerce-vault') {
  const snapshot = buildCommerceVaultSnapshot();
  return [
    { id: 'commerce-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-vault.api.document', method: 'GET', path: basePath + '/document', document: createCommerceVaultApiDocument(snapshot) }
  ];
}

