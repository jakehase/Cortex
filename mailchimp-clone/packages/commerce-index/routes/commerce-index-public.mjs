import { buildCommerceIndexSnapshot } from '../service-commerce-index.mjs';
import { createCommerceIndexFixtures } from '../fixtures-commerce-index.mjs';

export function createCommerceIndexPublicRoutes(basePath = '/public/commerce-index') {
  const snapshot = buildCommerceIndexSnapshot();
  const fixtures = createCommerceIndexFixtures();
  return [
    { id: 'commerce-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

