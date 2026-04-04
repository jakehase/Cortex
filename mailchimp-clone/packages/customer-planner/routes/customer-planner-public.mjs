import { buildCustomerPlannerSnapshot } from '../service-customer-planner.mjs';
import { createCustomerPlannerFixtures } from '../fixtures-customer-planner.mjs';

export function createCustomerPlannerPublicRoutes(basePath = '/public/customer-planner') {
  const snapshot = buildCustomerPlannerSnapshot();
  const fixtures = createCustomerPlannerFixtures();
  return [
    { id: 'customer-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'customer-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'customer-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

