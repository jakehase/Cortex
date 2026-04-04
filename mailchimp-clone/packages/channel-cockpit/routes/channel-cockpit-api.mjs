import { buildChannelCockpitSnapshot, createChannelCockpitApiDocument } from '../service-channel-cockpit.mjs';

export function createChannelCockpitApiRoutes(basePath = '/api/channel-cockpit') {
  const snapshot = buildChannelCockpitSnapshot();
  return [
    { id: 'channel-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createChannelCockpitApiDocument(snapshot) }
  ];
}

