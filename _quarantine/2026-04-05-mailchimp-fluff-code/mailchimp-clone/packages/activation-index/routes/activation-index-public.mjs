import { buildActivationIndexSnapshot } from '../service-activation-index.mjs';
import { createActivationIndexFixtures } from '../fixtures-activation-index.mjs';

export function createActivationIndexPublicRoutes(basePath = '/public/activation-index') {
  const snapshot = buildActivationIndexSnapshot();
  const fixtures = createActivationIndexFixtures();
  return [
    { id: 'activation-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

