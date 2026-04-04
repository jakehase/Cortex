import { buildChannelWatchtowerSnapshot, createChannelWatchtowerApiDocument } from '../service-channel-watchtower.mjs';

export function createChannelWatchtowerApiRoutes(basePath = '/api/channel-watchtower') {
  const snapshot = buildChannelWatchtowerSnapshot();
  return [
    { id: 'channel-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createChannelWatchtowerApiDocument(snapshot) }
  ];
}

