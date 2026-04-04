import { buildDataVaultSnapshot, createDataVaultApiDocument } from '../service-data-vault.mjs';

export function createDataVaultApiRoutes(basePath = '/api/data-vault') {
  const snapshot = buildDataVaultSnapshot();
  return [
    { id: 'data-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-vault.api.document', method: 'GET', path: basePath + '/document', document: createDataVaultApiDocument(snapshot) }
  ];
}

