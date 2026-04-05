import { buildActivationHubSnapshot } from '../service-activation-hub.mjs';
import { createActivationHubFixtures } from '../fixtures-activation-hub.mjs';

export function createActivationHubPublicRoutes(basePath = '/public/activation-hub') {
  const snapshot = buildActivationHubSnapshot();
  const fixtures = createActivationHubFixtures();
  return [
    { id: 'activation-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

