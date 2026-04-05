import { buildContentVaultSnapshot, createContentVaultApiDocument } from '../service-content-vault.mjs';

export function createContentVaultApiRoutes(basePath = '/api/content-vault') {
  const snapshot = buildContentVaultSnapshot();
  return [
    { id: 'content-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-vault.api.document', method: 'GET', path: basePath + '/document', document: createContentVaultApiDocument(snapshot) }
  ];
}

