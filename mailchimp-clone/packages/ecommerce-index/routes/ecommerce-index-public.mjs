import { buildEcommerceIndexSnapshot } from '../service-ecommerce-index.mjs';
import { createEcommerceIndexFixtures } from '../fixtures-ecommerce-index.mjs';

export function createEcommerceIndexPublicRoutes(basePath = '/public/ecommerce-index') {
  const snapshot = buildEcommerceIndexSnapshot();
  const fixtures = createEcommerceIndexFixtures();
  return [
    { id: 'ecommerce-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

