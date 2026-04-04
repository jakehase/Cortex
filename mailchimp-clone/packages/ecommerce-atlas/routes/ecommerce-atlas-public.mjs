import { buildEcommerceAtlasSnapshot } from '../service-ecommerce-atlas.mjs';
import { createEcommerceAtlasFixtures } from '../fixtures-ecommerce-atlas.mjs';

export function createEcommerceAtlasPublicRoutes(basePath = '/public/ecommerce-atlas') {
  const snapshot = buildEcommerceAtlasSnapshot();
  const fixtures = createEcommerceAtlasFixtures();
  return [
    { id: 'ecommerce-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

