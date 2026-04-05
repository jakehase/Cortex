import { buildEcommerceFoundrySnapshot } from '../service-ecommerce-foundry.mjs';
import { createEcommerceFoundryFixtures } from '../fixtures-ecommerce-foundry.mjs';

export function createEcommerceFoundryPublicRoutes(basePath = '/public/ecommerce-foundry') {
  const snapshot = buildEcommerceFoundrySnapshot();
  const fixtures = createEcommerceFoundryFixtures();
  return [
    { id: 'ecommerce-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

