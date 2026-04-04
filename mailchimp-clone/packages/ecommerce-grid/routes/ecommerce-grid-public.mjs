import { buildEcommerceGridSnapshot } from '../service-ecommerce-grid.mjs';
import { createEcommerceGridFixtures } from '../fixtures-ecommerce-grid.mjs';

export function createEcommerceGridPublicRoutes(basePath = '/public/ecommerce-grid') {
  const snapshot = buildEcommerceGridSnapshot();
  const fixtures = createEcommerceGridFixtures();
  return [
    { id: 'ecommerce-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

