import { buildActivationFoundrySnapshot } from '../service-activation-foundry.mjs';
import { createActivationFoundryFixtures } from '../fixtures-activation-foundry.mjs';

export function createActivationFoundryPublicRoutes(basePath = '/public/activation-foundry') {
  const snapshot = buildActivationFoundrySnapshot();
  const fixtures = createActivationFoundryFixtures();
  return [
    { id: 'activation-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

