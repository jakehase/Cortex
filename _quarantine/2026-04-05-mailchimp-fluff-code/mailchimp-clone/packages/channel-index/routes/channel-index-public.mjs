import { buildChannelIndexSnapshot } from '../service-channel-index.mjs';
import { createChannelIndexFixtures } from '../fixtures-channel-index.mjs';

export function createChannelIndexPublicRoutes(basePath = '/public/channel-index') {
  const snapshot = buildChannelIndexSnapshot();
  const fixtures = createChannelIndexFixtures();
  return [
    { id: 'channel-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

