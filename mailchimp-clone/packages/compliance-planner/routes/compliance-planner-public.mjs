import { buildCompliancePlannerSnapshot } from '../service-compliance-planner.mjs';
import { createCompliancePlannerFixtures } from '../fixtures-compliance-planner.mjs';

export function createCompliancePlannerPublicRoutes(basePath = '/public/compliance-planner') {
  const snapshot = buildCompliancePlannerSnapshot();
  const fixtures = createCompliancePlannerFixtures();
  return [
    { id: 'compliance-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'compliance-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'compliance-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

