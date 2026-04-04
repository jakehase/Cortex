import { buildCustomerExchangeSnapshot } from '../service-customer-exchange.mjs';
import { createCustomerExchangeFixtures } from '../fixtures-customer-exchange.mjs';

export function createCustomerExchangePublicRoutes(basePath = '/public/customer-exchange') {
  const snapshot = buildCustomerExchangeSnapshot();
  const fixtures = createCustomerExchangeFixtures();
  return [
    { id: 'customer-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

