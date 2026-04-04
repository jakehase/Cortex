import { buildCustomerWorkbenchSnapshot } from '../service-customer-workbench.mjs';
import { createCustomerWorkbenchFixtures } from '../fixtures-customer-workbench.mjs';

export function createCustomerWorkbenchPublicRoutes(basePath = '/public/customer-workbench') {
  const snapshot = buildCustomerWorkbenchSnapshot();
  const fixtures = createCustomerWorkbenchFixtures();
  return [
    { id: 'customer-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

