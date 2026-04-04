import { buildCommerceCockpitSnapshot } from '../service-commerce-cockpit.mjs';
import { createCommerceCockpitFixtures } from '../fixtures-commerce-cockpit.mjs';

export function createCommerceCockpitPublicRoutes(basePath = '/public/commerce-cockpit') {
  const snapshot = buildCommerceCockpitSnapshot();
  const fixtures = createCommerceCockpitFixtures();
  return [
    { id: 'commerce-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

