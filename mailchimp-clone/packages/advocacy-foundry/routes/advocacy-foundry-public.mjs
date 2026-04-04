import { buildAdvocacyFoundrySnapshot } from '../service-advocacy-foundry.mjs';
import { createAdvocacyFoundryFixtures } from '../fixtures-advocacy-foundry.mjs';

export function createAdvocacyFoundryPublicRoutes(basePath = '/public/advocacy-foundry') {
  const snapshot = buildAdvocacyFoundrySnapshot();
  const fixtures = createAdvocacyFoundryFixtures();
  return [
    { id: 'advocacy-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

