import { buildAdvocacyPlannerSnapshot } from '../service-advocacy-planner.mjs';
import { createAdvocacyPlannerFixtures } from '../fixtures-advocacy-planner.mjs';

export function createAdvocacyPlannerPublicRoutes(basePath = '/public/advocacy-planner') {
  const snapshot = buildAdvocacyPlannerSnapshot();
  const fixtures = createAdvocacyPlannerFixtures();
  return [
    { id: 'advocacy-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

