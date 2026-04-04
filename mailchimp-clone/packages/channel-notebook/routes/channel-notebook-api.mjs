import { buildChannelNotebookSnapshot, createChannelNotebookApiDocument } from '../service-channel-notebook.mjs';

export function createChannelNotebookApiRoutes(basePath = '/api/channel-notebook') {
  const snapshot = buildChannelNotebookSnapshot();
  return [
    { id: 'channel-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'channel-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'channel-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'channel-notebook.api.document', method: 'GET', path: basePath + '/document', document: createChannelNotebookApiDocument(snapshot) }
  ];
}

