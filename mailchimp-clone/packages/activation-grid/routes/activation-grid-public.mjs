import { buildActivationGridSnapshot } from '../service-activation-grid.mjs';
import { createActivationGridFixtures } from '../fixtures-activation-grid.mjs';

export function createActivationGridPublicRoutes(basePath = '/public/activation-grid') {
  const snapshot = buildActivationGridSnapshot();
  const fixtures = createActivationGridFixtures();
  return [
    { id: 'activation-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

