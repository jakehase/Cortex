import { buildActivationVaultSnapshot, createActivationVaultApiDocument } from '../service-activation-vault.mjs';

export function createActivationVaultApiRoutes(basePath = '/api/activation-vault') {
  const snapshot = buildActivationVaultSnapshot();
  return [
    { id: 'activation-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-vault.api.document', method: 'GET', path: basePath + '/document', document: createActivationVaultApiDocument(snapshot) }
  ];
}

