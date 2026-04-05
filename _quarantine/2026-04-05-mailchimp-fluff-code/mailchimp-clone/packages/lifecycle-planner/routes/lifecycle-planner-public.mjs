import { buildLifecyclePlannerSnapshot } from '../service-lifecycle-planner.mjs';
import { createLifecyclePlannerFixtures } from '../fixtures-lifecycle-planner.mjs';

export function createLifecyclePlannerPublicRoutes(basePath = '/public/lifecycle-planner') {
  const snapshot = buildLifecyclePlannerSnapshot();
  const fixtures = createLifecyclePlannerFixtures();
  return [
    { id: 'lifecycle-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

