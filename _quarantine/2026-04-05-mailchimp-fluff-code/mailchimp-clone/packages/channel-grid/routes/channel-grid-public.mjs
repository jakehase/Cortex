import { buildChannelGridSnapshot } from '../service-channel-grid.mjs';
import { createChannelGridFixtures } from '../fixtures-channel-grid.mjs';

export function createChannelGridPublicRoutes(basePath = '/public/channel-grid') {
  const snapshot = buildChannelGridSnapshot();
  const fixtures = createChannelGridFixtures();
  return [
    { id: 'channel-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

