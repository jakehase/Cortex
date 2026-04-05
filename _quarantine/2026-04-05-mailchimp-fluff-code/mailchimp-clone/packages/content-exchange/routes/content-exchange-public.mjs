import { buildContentExchangeSnapshot } from '../service-content-exchange.mjs';
import { createContentExchangeFixtures } from '../fixtures-content-exchange.mjs';

export function createContentExchangePublicRoutes(basePath = '/public/content-exchange') {
  const snapshot = buildContentExchangeSnapshot();
  const fixtures = createContentExchangeFixtures();
  return [
    { id: 'content-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

