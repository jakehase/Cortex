import { buildChannelNavigatorSnapshot } from '../service-channel-navigator.mjs';
import { createChannelNavigatorFixtures } from '../fixtures-channel-navigator.mjs';

export function createChannelNavigatorPublicRoutes(basePath = '/public/channel-navigator') {
  const snapshot = buildChannelNavigatorSnapshot();
  const fixtures = createChannelNavigatorFixtures();
  return [
    { id: 'channel-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

