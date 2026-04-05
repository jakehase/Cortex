import { buildChannelIndexSnapshot, createChannelIndexApiDocument } from '../service-channel-index.mjs';

export function createChannelIndexApiRoutes(basePath = '/api/channel-index') {
  const snapshot = buildChannelIndexSnapshot();
  return [
    { id: 'channel-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-index.api.document', method: 'GET', path: basePath + '/document', document: createChannelIndexApiDocument(snapshot) }
  ];
}

