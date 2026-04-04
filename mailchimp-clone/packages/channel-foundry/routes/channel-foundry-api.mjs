import { buildChannelFoundrySnapshot, createChannelFoundryApiDocument } from '../service-channel-foundry.mjs';

export function createChannelFoundryApiRoutes(basePath = '/api/channel-foundry') {
  const snapshot = buildChannelFoundrySnapshot();
  return [
    { id: 'channel-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-foundry.api.document', method: 'GET', path: basePath + '/document', document: createChannelFoundryApiDocument(snapshot) }
  ];
}

