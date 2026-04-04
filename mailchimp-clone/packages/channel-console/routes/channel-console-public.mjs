import { buildChannelConsoleSnapshot } from '../service-channel-console.mjs';
import { createChannelConsoleFixtures } from '../fixtures-channel-console.mjs';

export function createChannelConsolePublicRoutes(basePath = '/public/channel-console') {
  const snapshot = buildChannelConsoleSnapshot();
  const fixtures = createChannelConsoleFixtures();
  return [
    { id: 'channel-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

