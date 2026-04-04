import { buildCustomerWatchtowerSnapshot } from '../service-customer-watchtower.mjs';
import { createCustomerWatchtowerFixtures } from '../fixtures-customer-watchtower.mjs';

export function createCustomerWatchtowerPublicRoutes(basePath = '/public/customer-watchtower') {
  const snapshot = buildCustomerWatchtowerSnapshot();
  const fixtures = createCustomerWatchtowerFixtures();
  return [
    { id: 'customer-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

