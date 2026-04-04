import { buildAudienceVaultSnapshot, createAudienceVaultApiDocument } from '../service-audience-vault.mjs';

export function createAudienceVaultApiRoutes(basePath = '/api/audience-vault') {
  const snapshot = buildAudienceVaultSnapshot();
  return [
    { id: 'audience-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-vault.api.document', method: 'GET', path: basePath + '/document', document: createAudienceVaultApiDocument(snapshot) }
  ];
}

