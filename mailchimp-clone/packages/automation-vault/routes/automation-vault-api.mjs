import { buildAutomationVaultSnapshot, createAutomationVaultApiDocument } from '../service-automation-vault.mjs';

export function createAutomationVaultApiRoutes(basePath = '/api/automation-vault') {
  const snapshot = buildAutomationVaultSnapshot();
  return [
    { id: 'automation-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-vault.api.document', method: 'GET', path: basePath + '/document', document: createAutomationVaultApiDocument(snapshot) }
  ];
}

