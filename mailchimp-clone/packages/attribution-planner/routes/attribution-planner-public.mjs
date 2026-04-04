import { buildAttributionPlannerSnapshot } from '../service-attribution-planner.mjs';
import { createAttributionPlannerFixtures } from '../fixtures-attribution-planner.mjs';

export function createAttributionPlannerPublicRoutes(basePath = '/public/attribution-planner') {
  const snapshot = buildAttributionPlannerSnapshot();
  const fixtures = createAttributionPlannerFixtures();
  return [
    { id: 'attribution-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

