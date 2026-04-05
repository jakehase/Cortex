import { buildLoyaltyExchangeSnapshot } from '../service-loyalty-exchange.mjs';
import { createLoyaltyExchangeFixtures } from '../fixtures-loyalty-exchange.mjs';

export function createLoyaltyExchangePublicRoutes(basePath = '/public/loyalty-exchange') {
  const snapshot = buildLoyaltyExchangeSnapshot();
  const fixtures = createLoyaltyExchangeFixtures();
  return [
    { id: 'loyalty-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

