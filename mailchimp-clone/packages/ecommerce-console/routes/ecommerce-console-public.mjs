import { buildEcommerceConsoleSnapshot } from '../service-ecommerce-console.mjs';
import { createEcommerceConsoleFixtures } from '../fixtures-ecommerce-console.mjs';

export function createEcommerceConsolePublicRoutes(basePath = '/public/ecommerce-console') {
  const snapshot = buildEcommerceConsoleSnapshot();
  const fixtures = createEcommerceConsoleFixtures();
  return [
    { id: 'ecommerce-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

