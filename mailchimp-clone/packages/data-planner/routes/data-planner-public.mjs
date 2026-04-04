import { buildDataPlannerSnapshot } from '../service-data-planner.mjs';
import { createDataPlannerFixtures } from '../fixtures-data-planner.mjs';

export function createDataPlannerPublicRoutes(basePath = '/public/data-planner') {
  const snapshot = buildDataPlannerSnapshot();
  const fixtures = createDataPlannerFixtures();
  return [
    { id: 'data-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

