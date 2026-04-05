import { buildConsentVaultSnapshot, createConsentVaultApiDocument } from '../service-consent-vault.mjs';

export function createConsentVaultApiRoutes(basePath = '/api/consent-vault') {
  const snapshot = buildConsentVaultSnapshot();
  return [
    { id: 'consent-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-vault.api.document', method: 'GET', path: basePath + '/document', document: createConsentVaultApiDocument(snapshot) }
  ];
}

