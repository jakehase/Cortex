import { buildBillingPlannerSnapshot } from '../service-billing-planner.mjs';
import { createBillingPlannerFixtures } from '../fixtures-billing-planner.mjs';

export function createBillingPlannerPublicRoutes(basePath = '/public/billing-planner') {
  const snapshot = buildBillingPlannerSnapshot();
  const fixtures = createBillingPlannerFixtures();
  return [
    { id: 'billing-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

