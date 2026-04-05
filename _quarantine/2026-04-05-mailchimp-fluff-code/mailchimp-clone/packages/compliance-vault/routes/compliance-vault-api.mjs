import { buildComplianceVaultSnapshot, createComplianceVaultApiDocument } from '../service-compliance-vault.mjs';

export function createComplianceVaultApiRoutes(basePath = '/api/compliance-vault') {
  const snapshot = buildComplianceVaultSnapshot();
  return [
    { id: 'compliance-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-vault.api.document', method: 'GET', path: basePath + '/document', document: createComplianceVaultApiDocument(snapshot) }
  ];
}

