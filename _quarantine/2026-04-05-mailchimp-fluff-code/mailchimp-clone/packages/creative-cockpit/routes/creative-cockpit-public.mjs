import { buildCreativeCockpitSnapshot } from '../service-creative-cockpit.mjs';
import { createCreativeCockpitFixtures } from '../fixtures-creative-cockpit.mjs';

export function createCreativeCockpitPublicRoutes(basePath = '/public/creative-cockpit') {
  const snapshot = buildCreativeCockpitSnapshot();
  const fixtures = createCreativeCockpitFixtures();
  return [
    { id: 'creative-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

