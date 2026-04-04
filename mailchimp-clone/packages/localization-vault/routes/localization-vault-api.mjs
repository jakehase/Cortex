import { buildLocalizationVaultSnapshot, createLocalizationVaultApiDocument } from '../service-localization-vault.mjs';

export function createLocalizationVaultApiRoutes(basePath = '/api/localization-vault') {
  const snapshot = buildLocalizationVaultSnapshot();
  return [
    { id: 'localization-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-vault.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationVaultApiDocument(snapshot) }
  ];
}

