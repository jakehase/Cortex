import { buildChannelConsoleSnapshot, createChannelConsoleApiDocument } from '../service-channel-console.mjs';

export function createChannelConsoleApiRoutes(basePath = '/api/channel-console') {
  const snapshot = buildChannelConsoleSnapshot();
  return [
    { id: 'channel-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-console.api.document', method: 'GET', path: basePath + '/document', document: createChannelConsoleApiDocument(snapshot) }
  ];
}

