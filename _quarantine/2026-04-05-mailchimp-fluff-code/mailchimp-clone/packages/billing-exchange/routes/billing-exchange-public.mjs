import { buildBillingExchangeSnapshot } from '../service-billing-exchange.mjs';
import { createBillingExchangeFixtures } from '../fixtures-billing-exchange.mjs';

export function createBillingExchangePublicRoutes(basePath = '/public/billing-exchange') {
  const snapshot = buildBillingExchangeSnapshot();
  const fixtures = createBillingExchangeFixtures();
  return [
    { id: 'billing-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

