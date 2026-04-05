import { buildEcommerceCockpitSnapshot } from '../service-ecommerce-cockpit.mjs';
import { createEcommerceCockpitFixtures } from '../fixtures-ecommerce-cockpit.mjs';

export function createEcommerceCockpitPublicRoutes(basePath = '/public/ecommerce-cockpit') {
  const snapshot = buildEcommerceCockpitSnapshot();
  const fixtures = createEcommerceCockpitFixtures();
  return [
    { id: 'ecommerce-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

