import { buildCustomerFoundrySnapshot } from '../service-customer-foundry.mjs';
import { createCustomerFoundryFixtures } from '../fixtures-customer-foundry.mjs';

export function createCustomerFoundryPublicRoutes(basePath = '/public/customer-foundry') {
  const snapshot = buildCustomerFoundrySnapshot();
  const fixtures = createCustomerFoundryFixtures();
  return [
    { id: 'customer-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

