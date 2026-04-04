import { buildLoyaltyNavigatorSnapshot } from '../service-loyalty-navigator.mjs';
import { createLoyaltyNavigatorFixtures } from '../fixtures-loyalty-navigator.mjs';

export function createLoyaltyNavigatorPublicRoutes(basePath = '/public/loyalty-navigator') {
  const snapshot = buildLoyaltyNavigatorSnapshot();
  const fixtures = createLoyaltyNavigatorFixtures();
  return [
    { id: 'loyalty-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

