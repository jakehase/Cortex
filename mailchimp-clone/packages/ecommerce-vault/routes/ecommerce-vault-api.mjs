import { buildEcommerceVaultSnapshot, createEcommerceVaultApiDocument } from '../service-ecommerce-vault.mjs';

export function createEcommerceVaultApiRoutes(basePath = '/api/ecommerce-vault') {
  const snapshot = buildEcommerceVaultSnapshot();
  return [
    { id: 'ecommerce-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-vault.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceVaultApiDocument(snapshot) }
  ];
}

