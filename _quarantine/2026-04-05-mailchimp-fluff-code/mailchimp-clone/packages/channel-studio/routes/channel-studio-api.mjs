import { buildChannelStudioSnapshot, createChannelStudioApiDocument } from '../service-channel-studio.mjs';

export function createChannelStudioApiRoutes(basePath = '/api/channel-studio') {
  const snapshot = buildChannelStudioSnapshot();
  return [
    { id: 'channel-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-studio.api.document', method: 'GET', path: basePath + '/document', document: createChannelStudioApiDocument(snapshot) }
  ];
}

