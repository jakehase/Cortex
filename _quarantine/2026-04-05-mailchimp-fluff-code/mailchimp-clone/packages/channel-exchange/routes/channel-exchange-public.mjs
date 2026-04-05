import { buildChannelExchangeSnapshot } from '../service-channel-exchange.mjs';
import { createChannelExchangeFixtures } from '../fixtures-channel-exchange.mjs';

export function createChannelExchangePublicRoutes(basePath = '/public/channel-exchange') {
  const snapshot = buildChannelExchangeSnapshot();
  const fixtures = createChannelExchangeFixtures();
  return [
    { id: 'channel-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

