import { buildChannelHubSnapshot } from '../service-channel-hub.mjs';
import { createChannelHubFixtures } from '../fixtures-channel-hub.mjs';

export function createChannelHubPublicRoutes(basePath = '/public/channel-hub') {
  const snapshot = buildChannelHubSnapshot();
  const fixtures = createChannelHubFixtures();
  return [
    { id: 'channel-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

