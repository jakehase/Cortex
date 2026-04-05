import { buildChannelAdvisorSnapshot } from '../service-channel-advisor.mjs';
import { createChannelAdvisorFixtures } from '../fixtures-channel-advisor.mjs';

export function createChannelAdvisorPublicRoutes(basePath = '/public/channel-advisor') {
  const snapshot = buildChannelAdvisorSnapshot();
  const fixtures = createChannelAdvisorFixtures();
  return [
    { id: 'channel-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

