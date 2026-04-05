import { buildCommerceHubSnapshot } from '../service-commerce-hub.mjs';
import { createCommerceHubFixtures } from '../fixtures-commerce-hub.mjs';

export function createCommerceHubPublicRoutes(basePath = '/public/commerce-hub') {
  const snapshot = buildCommerceHubSnapshot();
  const fixtures = createCommerceHubFixtures();
  return [
    { id: 'commerce-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

