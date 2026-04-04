import { buildEcommerceHubSnapshot } from '../service-ecommerce-hub.mjs';
import { createEcommerceHubFixtures } from '../fixtures-ecommerce-hub.mjs';

export function createEcommerceHubPublicRoutes(basePath = '/public/ecommerce-hub') {
  const snapshot = buildEcommerceHubSnapshot();
  const fixtures = createEcommerceHubFixtures();
  return [
    { id: 'ecommerce-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

