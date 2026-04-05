import { buildCustomerAtlasSnapshot } from '../service-customer-atlas.mjs';
import { createCustomerAtlasFixtures } from '../fixtures-customer-atlas.mjs';

export function createCustomerAtlasPublicRoutes(basePath = '/public/customer-atlas') {
  const snapshot = buildCustomerAtlasSnapshot();
  const fixtures = createCustomerAtlasFixtures();
  return [
    { id: 'customer-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

