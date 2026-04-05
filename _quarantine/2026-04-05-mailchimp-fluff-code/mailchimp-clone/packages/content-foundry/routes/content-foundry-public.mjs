import { buildContentFoundrySnapshot } from '../service-content-foundry.mjs';
import { createContentFoundryFixtures } from '../fixtures-content-foundry.mjs';

export function createContentFoundryPublicRoutes(basePath = '/public/content-foundry') {
  const snapshot = buildContentFoundrySnapshot();
  const fixtures = createContentFoundryFixtures();
  return [
    { id: 'content-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

