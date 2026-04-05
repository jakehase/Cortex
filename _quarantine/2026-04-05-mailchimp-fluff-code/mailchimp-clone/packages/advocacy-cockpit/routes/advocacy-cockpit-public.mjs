import { buildAdvocacyCockpitSnapshot } from '../service-advocacy-cockpit.mjs';
import { createAdvocacyCockpitFixtures } from '../fixtures-advocacy-cockpit.mjs';

export function createAdvocacyCockpitPublicRoutes(basePath = '/public/advocacy-cockpit') {
  const snapshot = buildAdvocacyCockpitSnapshot();
  const fixtures = createAdvocacyCockpitFixtures();
  return [
    { id: 'advocacy-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

