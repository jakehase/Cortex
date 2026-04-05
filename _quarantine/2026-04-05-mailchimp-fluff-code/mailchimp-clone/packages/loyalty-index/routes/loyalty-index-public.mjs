import { buildLoyaltyIndexSnapshot } from '../service-loyalty-index.mjs';
import { createLoyaltyIndexFixtures } from '../fixtures-loyalty-index.mjs';

export function createLoyaltyIndexPublicRoutes(basePath = '/public/loyalty-index') {
  const snapshot = buildLoyaltyIndexSnapshot();
  const fixtures = createLoyaltyIndexFixtures();
  return [
    { id: 'loyalty-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

