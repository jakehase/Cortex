import { buildEcommerceStudioSnapshot } from '../service-ecommerce-studio.mjs';
import { createEcommerceStudioFixtures } from '../fixtures-ecommerce-studio.mjs';

export function createEcommerceStudioPublicRoutes(basePath = '/public/ecommerce-studio') {
  const snapshot = buildEcommerceStudioSnapshot();
  const fixtures = createEcommerceStudioFixtures();
  return [
    { id: 'ecommerce-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

