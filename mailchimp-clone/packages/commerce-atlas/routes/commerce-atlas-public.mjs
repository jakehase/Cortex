import { buildCommerceAtlasSnapshot } from '../service-commerce-atlas.mjs';
import { createCommerceAtlasFixtures } from '../fixtures-commerce-atlas.mjs';

export function createCommerceAtlasPublicRoutes(basePath = '/public/commerce-atlas') {
  const snapshot = buildCommerceAtlasSnapshot();
  const fixtures = createCommerceAtlasFixtures();
  return [
    { id: 'commerce-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

