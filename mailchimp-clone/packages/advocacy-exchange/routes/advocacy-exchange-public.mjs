import { buildAdvocacyExchangeSnapshot } from '../service-advocacy-exchange.mjs';
import { createAdvocacyExchangeFixtures } from '../fixtures-advocacy-exchange.mjs';

export function createAdvocacyExchangePublicRoutes(basePath = '/public/advocacy-exchange') {
  const snapshot = buildAdvocacyExchangeSnapshot();
  const fixtures = createAdvocacyExchangeFixtures();
  return [
    { id: 'advocacy-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

