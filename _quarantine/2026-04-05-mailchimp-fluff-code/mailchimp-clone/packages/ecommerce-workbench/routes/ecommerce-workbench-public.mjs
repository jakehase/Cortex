import { buildEcommerceWorkbenchSnapshot } from '../service-ecommerce-workbench.mjs';
import { createEcommerceWorkbenchFixtures } from '../fixtures-ecommerce-workbench.mjs';

export function createEcommerceWorkbenchPublicRoutes(basePath = '/public/ecommerce-workbench') {
  const snapshot = buildEcommerceWorkbenchSnapshot();
  const fixtures = createEcommerceWorkbenchFixtures();
  return [
    { id: 'ecommerce-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

