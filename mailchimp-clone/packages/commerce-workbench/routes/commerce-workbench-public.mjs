import { buildCommerceWorkbenchSnapshot } from '../service-commerce-workbench.mjs';
import { createCommerceWorkbenchFixtures } from '../fixtures-commerce-workbench.mjs';

export function createCommerceWorkbenchPublicRoutes(basePath = '/public/commerce-workbench') {
  const snapshot = buildCommerceWorkbenchSnapshot();
  const fixtures = createCommerceWorkbenchFixtures();
  return [
    { id: 'commerce-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

