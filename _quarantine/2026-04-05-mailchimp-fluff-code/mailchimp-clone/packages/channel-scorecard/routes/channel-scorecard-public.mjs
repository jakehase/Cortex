import { buildChannelScorecardSnapshot } from '../service-channel-scorecard.mjs';
import { createChannelScorecardFixtures } from '../fixtures-channel-scorecard.mjs';

export function createChannelScorecardPublicRoutes(basePath = '/public/channel-scorecard') {
  const snapshot = buildChannelScorecardSnapshot();
  const fixtures = createChannelScorecardFixtures();
  return [
    { id: 'channel-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

