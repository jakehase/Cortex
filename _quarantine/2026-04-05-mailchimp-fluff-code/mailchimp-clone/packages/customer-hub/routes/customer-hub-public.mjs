import { buildCustomerHubSnapshot } from '../service-customer-hub.mjs';
import { createCustomerHubFixtures } from '../fixtures-customer-hub.mjs';

export function createCustomerHubPublicRoutes(basePath = '/public/customer-hub') {
  const snapshot = buildCustomerHubSnapshot();
  const fixtures = createCustomerHubFixtures();
  return [
    { id: 'customer-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

