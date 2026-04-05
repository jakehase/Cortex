import { buildCustomerConsoleSnapshot } from '../service-customer-console.mjs';
import { createCustomerConsoleFixtures } from '../fixtures-customer-console.mjs';

export function createCustomerConsolePublicRoutes(basePath = '/public/customer-console') {
  const snapshot = buildCustomerConsoleSnapshot();
  const fixtures = createCustomerConsoleFixtures();
  return [
    { id: 'customer-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

