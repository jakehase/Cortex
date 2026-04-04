import { buildActivationConsoleSnapshot } from '../service-activation-console.mjs';
import { createActivationConsoleFixtures } from '../fixtures-activation-console.mjs';

export function createActivationConsolePublicRoutes(basePath = '/public/activation-console') {
  const snapshot = buildActivationConsoleSnapshot();
  const fixtures = createActivationConsoleFixtures();
  return [
    { id: 'activation-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

