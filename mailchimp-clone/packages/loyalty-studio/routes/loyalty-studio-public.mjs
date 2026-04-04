import { buildLoyaltyStudioSnapshot } from '../service-loyalty-studio.mjs';
import { createLoyaltyStudioFixtures } from '../fixtures-loyalty-studio.mjs';

export function createLoyaltyStudioPublicRoutes(basePath = '/public/loyalty-studio') {
  const snapshot = buildLoyaltyStudioSnapshot();
  const fixtures = createLoyaltyStudioFixtures();
  return [
    { id: 'loyalty-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

