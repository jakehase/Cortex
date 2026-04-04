import { buildBillingAtlasSnapshot } from '../service-billing-atlas.mjs';
import { createBillingAtlasFixtures } from '../fixtures-billing-atlas.mjs';

export function createBillingAtlasPublicRoutes(basePath = '/public/billing-atlas') {
  const snapshot = buildBillingAtlasSnapshot();
  const fixtures = createBillingAtlasFixtures();
  return [
    { id: 'billing-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

