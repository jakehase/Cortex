import { buildChannelCockpitSnapshot } from '../service-channel-cockpit.mjs';
import { createChannelCockpitFixtures } from '../fixtures-channel-cockpit.mjs';

export function createChannelCockpitPublicRoutes(basePath = '/public/channel-cockpit') {
  const snapshot = buildChannelCockpitSnapshot();
  const fixtures = createChannelCockpitFixtures();
  return [
    { id: 'channel-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

