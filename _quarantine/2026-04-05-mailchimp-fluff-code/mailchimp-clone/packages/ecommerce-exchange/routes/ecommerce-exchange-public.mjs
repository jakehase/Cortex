import { buildEcommerceExchangeSnapshot } from '../service-ecommerce-exchange.mjs';
import { createEcommerceExchangeFixtures } from '../fixtures-ecommerce-exchange.mjs';

export function createEcommerceExchangePublicRoutes(basePath = '/public/ecommerce-exchange') {
  const snapshot = buildEcommerceExchangeSnapshot();
  const fixtures = createEcommerceExchangeFixtures();
  return [
    { id: 'ecommerce-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

