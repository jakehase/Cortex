import { buildCreativePlannerSnapshot } from '../service-creative-planner.mjs';
import { createCreativePlannerFixtures } from '../fixtures-creative-planner.mjs';

export function createCreativePlannerPublicRoutes(basePath = '/public/creative-planner') {
  const snapshot = buildCreativePlannerSnapshot();
  const fixtures = createCreativePlannerFixtures();
  return [
    { id: 'creative-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

