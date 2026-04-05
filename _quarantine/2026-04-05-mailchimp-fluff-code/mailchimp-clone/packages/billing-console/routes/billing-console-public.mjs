import { buildBillingConsoleSnapshot } from '../service-billing-console.mjs';
import { createBillingConsoleFixtures } from '../fixtures-billing-console.mjs';

export function createBillingConsolePublicRoutes(basePath = '/public/billing-console') {
  const snapshot = buildBillingConsoleSnapshot();
  const fixtures = createBillingConsoleFixtures();
  return [
    { id: 'billing-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

