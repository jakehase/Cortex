import { buildCustomerGridSnapshot } from '../service-customer-grid.mjs';
import { createCustomerGridFixtures } from '../fixtures-customer-grid.mjs';

export function createCustomerGridPublicRoutes(basePath = '/public/customer-grid') {
  const snapshot = buildCustomerGridSnapshot();
  const fixtures = createCustomerGridFixtures();
  return [
    { id: 'customer-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

