import { buildEcommercePlannerSnapshot } from '../service-ecommerce-planner.mjs';
import { createEcommercePlannerFixtures } from '../fixtures-ecommerce-planner.mjs';

export function createEcommercePlannerPublicRoutes(basePath = '/public/ecommerce-planner') {
  const snapshot = buildEcommercePlannerSnapshot();
  const fixtures = createEcommercePlannerFixtures();
  return [
    { id: 'ecommerce-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

