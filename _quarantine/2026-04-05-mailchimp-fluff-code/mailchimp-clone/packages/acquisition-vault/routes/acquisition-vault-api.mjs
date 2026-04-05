import { buildAcquisitionVaultSnapshot, createAcquisitionVaultApiDocument } from '../service-acquisition-vault.mjs';

export function createAcquisitionVaultApiRoutes(basePath = '/api/acquisition-vault') {
  const snapshot = buildAcquisitionVaultSnapshot();
  return [
    { id: 'acquisition-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-vault.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionVaultApiDocument(snapshot) }
  ];
}

