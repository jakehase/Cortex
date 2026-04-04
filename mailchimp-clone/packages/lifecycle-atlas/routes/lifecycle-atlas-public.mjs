import { buildLifecycleAtlasSnapshot } from '../service-lifecycle-atlas.mjs';
import { createLifecycleAtlasFixtures } from '../fixtures-lifecycle-atlas.mjs';

export function createLifecycleAtlasPublicRoutes(basePath = '/public/lifecycle-atlas') {
  const snapshot = buildLifecycleAtlasSnapshot();
  const fixtures = createLifecycleAtlasFixtures();
  return [
    { id: 'lifecycle-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

