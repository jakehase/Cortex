import { buildCustomerNavigatorSnapshot } from '../service-customer-navigator.mjs';
import { createCustomerNavigatorFixtures } from '../fixtures-customer-navigator.mjs';

export function createCustomerNavigatorPublicRoutes(basePath = '/public/customer-navigator') {
  const snapshot = buildCustomerNavigatorSnapshot();
  const fixtures = createCustomerNavigatorFixtures();
  return [
    { id: 'customer-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

