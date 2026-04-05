import { buildEcommerceNavigatorSnapshot } from '../service-ecommerce-navigator.mjs';
import { createEcommerceNavigatorFixtures } from '../fixtures-ecommerce-navigator.mjs';

export function createEcommerceNavigatorPublicRoutes(basePath = '/public/ecommerce-navigator') {
  const snapshot = buildEcommerceNavigatorSnapshot();
  const fixtures = createEcommerceNavigatorFixtures();
  return [
    { id: 'ecommerce-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

