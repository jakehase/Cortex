import { buildDeliverabilityPlannerSnapshot } from '../service-deliverability-planner.mjs';
import { createDeliverabilityPlannerFixtures } from '../fixtures-deliverability-planner.mjs';

export function createDeliverabilityPlannerPublicRoutes(basePath = '/public/deliverability-planner') {
  const snapshot = buildDeliverabilityPlannerSnapshot();
  const fixtures = createDeliverabilityPlannerFixtures();
  return [
    { id: 'deliverability-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

