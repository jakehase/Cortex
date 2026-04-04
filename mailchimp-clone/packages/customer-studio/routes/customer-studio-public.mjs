import { buildCustomerStudioSnapshot } from '../service-customer-studio.mjs';
import { createCustomerStudioFixtures } from '../fixtures-customer-studio.mjs';

export function createCustomerStudioPublicRoutes(basePath = '/public/customer-studio') {
  const snapshot = buildCustomerStudioSnapshot();
  const fixtures = createCustomerStudioFixtures();
  return [
    { id: 'customer-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

