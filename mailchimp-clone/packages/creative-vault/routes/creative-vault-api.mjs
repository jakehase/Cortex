import { buildCreativeVaultSnapshot, createCreativeVaultApiDocument } from '../service-creative-vault.mjs';

export function createCreativeVaultApiRoutes(basePath = '/api/creative-vault') {
  const snapshot = buildCreativeVaultSnapshot();
  return [
    { id: 'creative-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-vault.api.document', method: 'GET', path: basePath + '/document', document: createCreativeVaultApiDocument(snapshot) }
  ];
}

