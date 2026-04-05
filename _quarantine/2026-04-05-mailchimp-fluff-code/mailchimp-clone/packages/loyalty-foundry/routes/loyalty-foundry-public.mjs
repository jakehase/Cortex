import { buildLoyaltyFoundrySnapshot } from '../service-loyalty-foundry.mjs';
import { createLoyaltyFoundryFixtures } from '../fixtures-loyalty-foundry.mjs';

export function createLoyaltyFoundryPublicRoutes(basePath = '/public/loyalty-foundry') {
  const snapshot = buildLoyaltyFoundrySnapshot();
  const fixtures = createLoyaltyFoundryFixtures();
  return [
    { id: 'loyalty-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

