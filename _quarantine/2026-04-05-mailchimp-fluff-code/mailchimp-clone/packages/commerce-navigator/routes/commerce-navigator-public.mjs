import { buildCommerceNavigatorSnapshot } from '../service-commerce-navigator.mjs';
import { createCommerceNavigatorFixtures } from '../fixtures-commerce-navigator.mjs';

export function createCommerceNavigatorPublicRoutes(basePath = '/public/commerce-navigator') {
  const snapshot = buildCommerceNavigatorSnapshot();
  const fixtures = createCommerceNavigatorFixtures();
  return [
    { id: 'commerce-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

