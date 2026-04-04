import { buildChannelStudioSnapshot } from '../service-channel-studio.mjs';
import { createChannelStudioFixtures } from '../fixtures-channel-studio.mjs';

export function createChannelStudioPublicRoutes(basePath = '/public/channel-studio') {
  const snapshot = buildChannelStudioSnapshot();
  const fixtures = createChannelStudioFixtures();
  return [
    { id: 'channel-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

