import { buildCommerceConsoleSnapshot } from '../service-commerce-console.mjs';
import { createCommerceConsoleFixtures } from '../fixtures-commerce-console.mjs';

export function createCommerceConsolePublicRoutes(basePath = '/public/commerce-console') {
  const snapshot = buildCommerceConsoleSnapshot();
  const fixtures = createCommerceConsoleFixtures();
  return [
    { id: 'commerce-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

