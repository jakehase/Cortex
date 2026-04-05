import { buildCommerceStudioSnapshot } from '../service-commerce-studio.mjs';
import { createCommerceStudioFixtures } from '../fixtures-commerce-studio.mjs';

export function createCommerceStudioPublicRoutes(basePath = '/public/commerce-studio') {
  const snapshot = buildCommerceStudioSnapshot();
  const fixtures = createCommerceStudioFixtures();
  return [
    { id: 'commerce-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

