import { buildAttributionVaultSnapshot, createAttributionVaultApiDocument } from '../service-attribution-vault.mjs';

export function createAttributionVaultApiRoutes(basePath = '/api/attribution-vault') {
  const snapshot = buildAttributionVaultSnapshot();
  return [
    { id: 'attribution-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-vault.api.document', method: 'GET', path: basePath + '/document', document: createAttributionVaultApiDocument(snapshot) }
  ];
}

