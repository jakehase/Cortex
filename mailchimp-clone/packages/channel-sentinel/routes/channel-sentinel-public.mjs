import { buildChannelSentinelSnapshot } from '../service-channel-sentinel.mjs';
import { createChannelSentinelFixtures } from '../fixtures-channel-sentinel.mjs';

export function createChannelSentinelPublicRoutes(basePath = '/public/channel-sentinel') {
  const snapshot = buildChannelSentinelSnapshot();
  const fixtures = createChannelSentinelFixtures();
  return [
    { id: 'channel-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

