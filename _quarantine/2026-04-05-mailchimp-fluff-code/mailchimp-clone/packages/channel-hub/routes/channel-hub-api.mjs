import { buildChannelHubSnapshot, createChannelHubApiDocument } from '../service-channel-hub.mjs';

export function createChannelHubApiRoutes(basePath = '/api/channel-hub') {
  const snapshot = buildChannelHubSnapshot();
  return [
    { id: 'channel-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-hub.api.document', method: 'GET', path: basePath + '/document', document: createChannelHubApiDocument(snapshot) }
  ];
}

