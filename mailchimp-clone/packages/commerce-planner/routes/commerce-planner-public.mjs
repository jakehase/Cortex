import { buildCommercePlannerSnapshot } from '../service-commerce-planner.mjs';
import { createCommercePlannerFixtures } from '../fixtures-commerce-planner.mjs';

export function createCommercePlannerPublicRoutes(basePath = '/public/commerce-planner') {
  const snapshot = buildCommercePlannerSnapshot();
  const fixtures = createCommercePlannerFixtures();
  return [
    { id: 'commerce-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

