import { buildLifecycleVaultSnapshot, createLifecycleVaultApiDocument } from '../service-lifecycle-vault.mjs';

export function createLifecycleVaultApiRoutes(basePath = '/api/lifecycle-vault') {
  const snapshot = buildLifecycleVaultSnapshot();
  return [
    { id: 'lifecycle-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-vault.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleVaultApiDocument(snapshot) }
  ];
}

