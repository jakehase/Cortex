import { buildChannelNavigatorSnapshot, createChannelNavigatorApiDocument } from '../service-channel-navigator.mjs';

export function createChannelNavigatorApiRoutes(basePath = '/api/channel-navigator') {
  const snapshot = buildChannelNavigatorSnapshot();
  return [
    { id: 'channel-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-navigator.api.document', method: 'GET', path: basePath + '/document', document: createChannelNavigatorApiDocument(snapshot) }
  ];
}

