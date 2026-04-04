import { buildActivationCockpitSnapshot } from '../service-activation-cockpit.mjs';
import { createActivationCockpitFixtures } from '../fixtures-activation-cockpit.mjs';

export function createActivationCockpitPublicRoutes(basePath = '/public/activation-cockpit') {
  const snapshot = buildActivationCockpitSnapshot();
  const fixtures = createActivationCockpitFixtures();
  return [
    { id: 'activation-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

