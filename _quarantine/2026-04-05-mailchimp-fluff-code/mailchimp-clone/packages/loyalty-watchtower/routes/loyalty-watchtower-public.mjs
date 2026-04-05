import { buildLoyaltyWatchtowerSnapshot } from '../service-loyalty-watchtower.mjs';
import { createLoyaltyWatchtowerFixtures } from '../fixtures-loyalty-watchtower.mjs';

export function createLoyaltyWatchtowerPublicRoutes(basePath = '/public/loyalty-watchtower') {
  const snapshot = buildLoyaltyWatchtowerSnapshot();
  const fixtures = createLoyaltyWatchtowerFixtures();
  return [
    { id: 'loyalty-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

