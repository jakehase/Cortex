import { buildLoyaltyHubSnapshot } from '../service-loyalty-hub.mjs';
import { createLoyaltyHubFixtures } from '../fixtures-loyalty-hub.mjs';

export function createLoyaltyHubPublicRoutes(basePath = '/public/loyalty-hub') {
  const snapshot = buildLoyaltyHubSnapshot();
  const fixtures = createLoyaltyHubFixtures();
  return [
    { id: 'loyalty-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

