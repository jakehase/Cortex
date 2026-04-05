import { buildChannelGridSnapshot, createChannelGridApiDocument } from '../service-channel-grid.mjs';

export function createChannelGridApiRoutes(basePath = '/api/channel-grid') {
  const snapshot = buildChannelGridSnapshot();
  return [
    { id: 'channel-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-grid.api.document', method: 'GET', path: basePath + '/document', document: createChannelGridApiDocument(snapshot) }
  ];
}

