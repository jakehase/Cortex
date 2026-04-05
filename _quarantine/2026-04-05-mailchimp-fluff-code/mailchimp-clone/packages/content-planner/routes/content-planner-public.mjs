import { buildContentPlannerSnapshot } from '../service-content-planner.mjs';
import { createContentPlannerFixtures } from '../fixtures-content-planner.mjs';

export function createContentPlannerPublicRoutes(basePath = '/public/content-planner') {
  const snapshot = buildContentPlannerSnapshot();
  const fixtures = createContentPlannerFixtures();
  return [
    { id: 'content-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

