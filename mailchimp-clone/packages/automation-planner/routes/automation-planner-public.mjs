import { buildAutomationPlannerSnapshot } from '../service-automation-planner.mjs';
import { createAutomationPlannerFixtures } from '../fixtures-automation-planner.mjs';

export function createAutomationPlannerPublicRoutes(basePath = '/public/automation-planner') {
  const snapshot = buildAutomationPlannerSnapshot();
  const fixtures = createAutomationPlannerFixtures();
  return [
    { id: 'automation-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

