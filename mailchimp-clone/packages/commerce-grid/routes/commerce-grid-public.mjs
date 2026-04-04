import { buildCommerceGridSnapshot } from '../service-commerce-grid.mjs';
import { createCommerceGridFixtures } from '../fixtures-commerce-grid.mjs';

export function createCommerceGridPublicRoutes(basePath = '/public/commerce-grid') {
  const snapshot = buildCommerceGridSnapshot();
  const fixtures = createCommerceGridFixtures();
  return [
    { id: 'commerce-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

