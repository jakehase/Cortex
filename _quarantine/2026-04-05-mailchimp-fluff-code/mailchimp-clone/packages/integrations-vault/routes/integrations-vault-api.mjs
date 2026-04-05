import { buildIntegrationsVaultSnapshot, createIntegrationsVaultApiDocument } from '../service-integrations-vault.mjs';

export function createIntegrationsVaultApiRoutes(basePath = '/api/integrations-vault') {
  const snapshot = buildIntegrationsVaultSnapshot();
  return [
    { id: 'integrations-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-vault.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsVaultApiDocument(snapshot) }
  ];
}

