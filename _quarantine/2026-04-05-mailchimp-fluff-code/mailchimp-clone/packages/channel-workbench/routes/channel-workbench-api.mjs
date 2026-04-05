import { buildChannelWorkbenchSnapshot, createChannelWorkbenchApiDocument } from '../service-channel-workbench.mjs';

export function createChannelWorkbenchApiRoutes(basePath = '/api/channel-workbench') {
  const snapshot = buildChannelWorkbenchSnapshot();
  return [
    { id: 'channel-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-workbench.api.document', method: 'GET', path: basePath + '/document', document: createChannelWorkbenchApiDocument(snapshot) }
  ];
}

