import { buildLoyaltyPlannerSnapshot } from '../service-loyalty-planner.mjs';
import { createLoyaltyPlannerFixtures } from '../fixtures-loyalty-planner.mjs';

export function createLoyaltyPlannerPublicRoutes(basePath = '/public/loyalty-planner') {
  const snapshot = buildLoyaltyPlannerSnapshot();
  const fixtures = createLoyaltyPlannerFixtures();
  return [
    { id: 'loyalty-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

