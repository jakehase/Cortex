import { buildCreativeFoundrySnapshot } from '../service-creative-foundry.mjs';
import { createCreativeFoundryFixtures } from '../fixtures-creative-foundry.mjs';

export function createCreativeFoundryPublicRoutes(basePath = '/public/creative-foundry') {
  const snapshot = buildCreativeFoundrySnapshot();
  const fixtures = createCreativeFoundryFixtures();
  return [
    { id: 'creative-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

