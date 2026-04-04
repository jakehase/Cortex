import { buildChannelPlannerSnapshot } from '../service-channel-planner.mjs';
import { createChannelPlannerFixtures } from '../fixtures-channel-planner.mjs';

export function createChannelPlannerPublicRoutes(basePath = '/public/channel-planner') {
  const snapshot = buildChannelPlannerSnapshot();
  const fixtures = createChannelPlannerFixtures();
  return [
    { id: 'channel-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'channel-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'channel-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

