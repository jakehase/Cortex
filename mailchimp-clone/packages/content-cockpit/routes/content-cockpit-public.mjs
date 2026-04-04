import { buildContentCockpitSnapshot } from '../service-content-cockpit.mjs';
import { createContentCockpitFixtures } from '../fixtures-content-cockpit.mjs';

export function createContentCockpitPublicRoutes(basePath = '/public/content-cockpit') {
  const snapshot = buildContentCockpitSnapshot();
  const fixtures = createContentCockpitFixtures();
  return [
    { id: 'content-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

