import { buildEcommerceWatchtowerSnapshot } from '../service-ecommerce-watchtower.mjs';
import { createEcommerceWatchtowerFixtures } from '../fixtures-ecommerce-watchtower.mjs';

export function createEcommerceWatchtowerPublicRoutes(basePath = '/public/ecommerce-watchtower') {
  const snapshot = buildEcommerceWatchtowerSnapshot();
  const fixtures = createEcommerceWatchtowerFixtures();
  return [
    { id: 'ecommerce-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

