import { buildAutomationExchangeSnapshot } from '../service-automation-exchange.mjs';
import { createAutomationExchangeFixtures } from '../fixtures-automation-exchange.mjs';

export function createAutomationExchangePublicRoutes(basePath = '/public/automation-exchange') {
  const snapshot = buildAutomationExchangeSnapshot();
  const fixtures = createAutomationExchangeFixtures();
  return [
    { id: 'automation-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

