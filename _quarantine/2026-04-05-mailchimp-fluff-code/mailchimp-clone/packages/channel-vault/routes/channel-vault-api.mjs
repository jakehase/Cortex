import { buildChannelVaultSnapshot, createChannelVaultApiDocument } from '../service-channel-vault.mjs';

export function createChannelVaultApiRoutes(basePath = '/api/channel-vault') {
  const snapshot = buildChannelVaultSnapshot();
  return [
    { id: 'channel-vault.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-vault.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-vault.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-vault.api.document', method: 'GET', path: basePath + '/document', document: createChannelVaultApiDocument(snapshot) }
  ];
}

