import { buildChannelSentinelSnapshot, createChannelSentinelApiDocument } from '../service-channel-sentinel.mjs';

export function createChannelSentinelApiRoutes(basePath = '/api/channel-sentinel') {
  const snapshot = buildChannelSentinelSnapshot();
  return [
    { id: 'channel-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createChannelSentinelApiDocument(snapshot) }
  ];
}

