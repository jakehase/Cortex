import { buildCommerceExchangeSnapshot } from '../service-commerce-exchange.mjs';
import { createCommerceExchangeFixtures } from '../fixtures-commerce-exchange.mjs';

export function createCommerceExchangePublicRoutes(basePath = '/public/commerce-exchange') {
  const snapshot = buildCommerceExchangeSnapshot();
  const fixtures = createCommerceExchangeFixtures();
  return [
    { id: 'commerce-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

