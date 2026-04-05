import { buildAttributionExchangeSnapshot } from '../service-attribution-exchange.mjs';
import { createAttributionExchangeFixtures } from '../fixtures-attribution-exchange.mjs';

export function createAttributionExchangePublicRoutes(basePath = '/public/attribution-exchange') {
  const snapshot = buildAttributionExchangeSnapshot();
  const fixtures = createAttributionExchangeFixtures();
  return [
    { id: 'attribution-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

