import { buildLoyaltyConsoleSnapshot } from '../service-loyalty-console.mjs';
import { createLoyaltyConsoleFixtures } from '../fixtures-loyalty-console.mjs';

export function createLoyaltyConsolePublicRoutes(basePath = '/public/loyalty-console') {
  const snapshot = buildLoyaltyConsoleSnapshot();
  const fixtures = createLoyaltyConsoleFixtures();
  return [
    { id: 'loyalty-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

