import { buildActivationNavigatorSnapshot } from '../service-activation-navigator.mjs';
import { createActivationNavigatorFixtures } from '../fixtures-activation-navigator.mjs';

export function createActivationNavigatorPublicRoutes(basePath = '/public/activation-navigator') {
  const snapshot = buildActivationNavigatorSnapshot();
  const fixtures = createActivationNavigatorFixtures();
  return [
    { id: 'activation-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

