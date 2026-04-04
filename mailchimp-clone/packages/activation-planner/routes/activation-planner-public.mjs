import { buildActivationPlannerSnapshot } from '../service-activation-planner.mjs';
import { createActivationPlannerFixtures } from '../fixtures-activation-planner.mjs';

export function createActivationPlannerPublicRoutes(basePath = '/public/activation-planner') {
  const snapshot = buildActivationPlannerSnapshot();
  const fixtures = createActivationPlannerFixtures();
  return [
    { id: 'activation-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

