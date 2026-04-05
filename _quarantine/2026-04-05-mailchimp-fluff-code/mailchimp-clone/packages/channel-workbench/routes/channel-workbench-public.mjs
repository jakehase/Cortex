import { buildChannelWorkbenchSnapshot } from '../service-channel-workbench.mjs';
import { createChannelWorkbenchFixtures } from '../fixtures-channel-workbench.mjs';

export function createChannelWorkbenchPublicRoutes(basePath = '/public/channel-workbench') {
  const snapshot = buildChannelWorkbenchSnapshot();
  const fixtures = createChannelWorkbenchFixtures();
  return [
    { id: 'channel-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

