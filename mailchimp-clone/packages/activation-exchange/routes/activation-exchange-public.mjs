import { buildActivationExchangeSnapshot } from '../service-activation-exchange.mjs';
import { createActivationExchangeFixtures } from '../fixtures-activation-exchange.mjs';

export function createActivationExchangePublicRoutes(basePath = '/public/activation-exchange') {
  const snapshot = buildActivationExchangeSnapshot();
  const fixtures = createActivationExchangeFixtures();
  return [
    { id: 'activation-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

