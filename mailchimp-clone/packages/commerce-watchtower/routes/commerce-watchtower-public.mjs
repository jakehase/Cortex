import { buildCommerceWatchtowerSnapshot } from '../service-commerce-watchtower.mjs';
import { createCommerceWatchtowerFixtures } from '../fixtures-commerce-watchtower.mjs';

export function createCommerceWatchtowerPublicRoutes(basePath = '/public/commerce-watchtower') {
  const snapshot = buildCommerceWatchtowerSnapshot();
  const fixtures = createCommerceWatchtowerFixtures();
  return [
    { id: 'commerce-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

