import { buildDataExchangeSnapshot } from '../service-data-exchange.mjs';
import { createDataExchangeFixtures } from '../fixtures-data-exchange.mjs';

export function createDataExchangePublicRoutes(basePath = '/public/data-exchange') {
  const snapshot = buildDataExchangeSnapshot();
  const fixtures = createDataExchangeFixtures();
  return [
    { id: 'data-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

