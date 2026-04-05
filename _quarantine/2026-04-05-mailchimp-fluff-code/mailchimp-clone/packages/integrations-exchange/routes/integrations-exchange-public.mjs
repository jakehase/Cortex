import { buildIntegrationsExchangeSnapshot } from '../service-integrations-exchange.mjs';
import { createIntegrationsExchangeFixtures } from '../fixtures-integrations-exchange.mjs';

export function createIntegrationsExchangePublicRoutes(basePath = '/public/integrations-exchange') {
  const snapshot = buildIntegrationsExchangeSnapshot();
  const fixtures = createIntegrationsExchangeFixtures();
  return [
    { id: 'integrations-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

