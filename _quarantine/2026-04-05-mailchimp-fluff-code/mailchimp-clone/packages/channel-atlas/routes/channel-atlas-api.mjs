import { buildChannelAtlasSnapshot, createChannelAtlasApiDocument } from '../service-channel-atlas.mjs';

export function createChannelAtlasApiRoutes(basePath = '/api/channel-atlas') {
  const snapshot = buildChannelAtlasSnapshot();
  return [
    { id: 'channel-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-atlas.api.document', method: 'GET', path: basePath + '/document', document: createChannelAtlasApiDocument(snapshot) }
  ];
}

