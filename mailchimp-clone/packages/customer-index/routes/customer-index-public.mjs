import { buildCustomerIndexSnapshot } from '../service-customer-index.mjs';
import { createCustomerIndexFixtures } from '../fixtures-customer-index.mjs';

export function createCustomerIndexPublicRoutes(basePath = '/public/customer-index') {
  const snapshot = buildCustomerIndexSnapshot();
  const fixtures = createCustomerIndexFixtures();
  return [
    { id: 'customer-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

