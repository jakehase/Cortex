import { buildChannelAtlasSnapshot } from '../service-channel-atlas.mjs';
import { createChannelAtlasFixtures } from '../fixtures-channel-atlas.mjs';

export function createChannelAtlasPublicRoutes(basePath = '/public/channel-atlas') {
  const snapshot = buildChannelAtlasSnapshot();
  const fixtures = createChannelAtlasFixtures();
  return [
    { id: 'channel-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

