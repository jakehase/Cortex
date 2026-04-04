import { buildChannelNotebookSnapshot } from '../service-channel-notebook.mjs';
import { createChannelNotebookFixtures } from '../fixtures-channel-notebook.mjs';

export function createChannelNotebookPublicRoutes(basePath = '/public/channel-notebook') {
  const snapshot = buildChannelNotebookSnapshot();
  const fixtures = createChannelNotebookFixtures();
  return [
    { id: 'channel-notebook.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-notebook.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-notebook.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

