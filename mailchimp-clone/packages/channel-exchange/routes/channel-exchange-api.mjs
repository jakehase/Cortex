import { buildChannelExchangeSnapshot, createChannelExchangeApiDocument } from '../service-channel-exchange.mjs';

export function createChannelExchangeApiRoutes(basePath = '/api/channel-exchange') {
  const snapshot = buildChannelExchangeSnapshot();
  return [
    { id: 'channel-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-exchange.api.document', method: 'GET', path: basePath + '/document', document: createChannelExchangeApiDocument(snapshot) }
  ];
}

