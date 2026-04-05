import { buildLifecycleCockpitSnapshot } from '../service-lifecycle-cockpit.mjs';
import { createLifecycleCockpitFixtures } from '../fixtures-lifecycle-cockpit.mjs';

export function createLifecycleCockpitPublicRoutes(basePath = '/public/lifecycle-cockpit') {
  const snapshot = buildLifecycleCockpitSnapshot();
  const fixtures = createLifecycleCockpitFixtures();
  return [
    { id: 'lifecycle-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

