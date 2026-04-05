import { buildCreativeExchangeSnapshot } from '../service-creative-exchange.mjs';
import { createCreativeExchangeFixtures } from '../fixtures-creative-exchange.mjs';

export function createCreativeExchangePublicRoutes(basePath = '/public/creative-exchange') {
  const snapshot = buildCreativeExchangeSnapshot();
  const fixtures = createCreativeExchangeFixtures();
  return [
    { id: 'creative-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

