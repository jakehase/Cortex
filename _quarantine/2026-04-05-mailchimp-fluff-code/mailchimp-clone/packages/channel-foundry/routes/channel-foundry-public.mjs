import { buildChannelFoundrySnapshot } from '../service-channel-foundry.mjs';
import { createChannelFoundryFixtures } from '../fixtures-channel-foundry.mjs';

export function createChannelFoundryPublicRoutes(basePath = '/public/channel-foundry') {
  const snapshot = buildChannelFoundrySnapshot();
  const fixtures = createChannelFoundryFixtures();
  return [
    { id: 'channel-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

