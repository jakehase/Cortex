import { buildChannelWatchtowerSnapshot } from '../service-channel-watchtower.mjs';
import { createChannelWatchtowerFixtures } from '../fixtures-channel-watchtower.mjs';

export function createChannelWatchtowerPublicRoutes(basePath = '/public/channel-watchtower') {
  const snapshot = buildChannelWatchtowerSnapshot();
  const fixtures = createChannelWatchtowerFixtures();
  return [
    { id: 'channel-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

