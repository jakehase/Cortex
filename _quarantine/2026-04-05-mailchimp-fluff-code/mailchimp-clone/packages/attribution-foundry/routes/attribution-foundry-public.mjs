import { buildAttributionFoundrySnapshot } from '../service-attribution-foundry.mjs';
import { createAttributionFoundryFixtures } from '../fixtures-attribution-foundry.mjs';

export function createAttributionFoundryPublicRoutes(basePath = '/public/attribution-foundry') {
  const snapshot = buildAttributionFoundrySnapshot();
  const fixtures = createAttributionFoundryFixtures();
  return [
    { id: 'attribution-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

