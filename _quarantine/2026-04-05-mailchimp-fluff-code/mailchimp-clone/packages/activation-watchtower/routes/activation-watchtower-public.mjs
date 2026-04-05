import { buildActivationWatchtowerSnapshot } from '../service-activation-watchtower.mjs';
import { createActivationWatchtowerFixtures } from '../fixtures-activation-watchtower.mjs';

export function createActivationWatchtowerPublicRoutes(basePath = '/public/activation-watchtower') {
  const snapshot = buildActivationWatchtowerSnapshot();
  const fixtures = createActivationWatchtowerFixtures();
  return [
    { id: 'activation-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

