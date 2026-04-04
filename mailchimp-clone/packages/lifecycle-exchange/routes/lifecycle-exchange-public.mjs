import { buildLifecycleExchangeSnapshot } from '../service-lifecycle-exchange.mjs';
import { createLifecycleExchangeFixtures } from '../fixtures-lifecycle-exchange.mjs';

export function createLifecycleExchangePublicRoutes(basePath = '/public/lifecycle-exchange') {
  const snapshot = buildLifecycleExchangeSnapshot();
  const fixtures = createLifecycleExchangeFixtures();
  return [
    { id: 'lifecycle-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

