import { buildLoyaltyGridSnapshot } from '../service-loyalty-grid.mjs';
import { createLoyaltyGridFixtures } from '../fixtures-loyalty-grid.mjs';

export function createLoyaltyGridPublicRoutes(basePath = '/public/loyalty-grid') {
  const snapshot = buildLoyaltyGridSnapshot();
  const fixtures = createLoyaltyGridFixtures();
  return [
    { id: 'loyalty-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

