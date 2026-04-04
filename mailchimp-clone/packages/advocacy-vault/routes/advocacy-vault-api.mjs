import { buildAdvocacyVaultSnapshot, createAdvocacyVaultApiDocument } from '../service-advocacy-vault.mjs';

export function createAdvocacyVaultApiRoutes(basePath = '/api/advocacy-vault') {
  const snapshot = buildAdvocacyVaultSnapshot();
  return [
    { id: 'advocacy-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-vault.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyVaultApiDocument(snapshot) }
  ];
}

