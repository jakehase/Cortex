import { buildActivationStudioSnapshot } from '../service-activation-studio.mjs';
import { createActivationStudioFixtures } from '../fixtures-activation-studio.mjs';

export function createActivationStudioPublicRoutes(basePath = '/public/activation-studio') {
  const snapshot = buildActivationStudioSnapshot();
  const fixtures = createActivationStudioFixtures();
  return [
    { id: 'activation-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

