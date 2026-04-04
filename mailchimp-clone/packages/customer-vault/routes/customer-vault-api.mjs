import { buildCustomerVaultSnapshot, createCustomerVaultApiDocument } from '../service-customer-vault.mjs';

export function createCustomerVaultApiRoutes(basePath = '/api/customer-vault') {
  const snapshot = buildCustomerVaultSnapshot();
  return [
    { id: 'customer-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-vault.api.document', method: 'GET', path: basePath + '/document', document: createCustomerVaultApiDocument(snapshot) }
  ];
}

