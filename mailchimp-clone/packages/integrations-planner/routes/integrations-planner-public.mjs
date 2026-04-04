import { buildIntegrationsPlannerSnapshot } from '../service-integrations-planner.mjs';
import { createIntegrationsPlannerFixtures } from '../fixtures-integrations-planner.mjs';

export function createIntegrationsPlannerPublicRoutes(basePath = '/public/integrations-planner') {
  const snapshot = buildIntegrationsPlannerSnapshot();
  const fixtures = createIntegrationsPlannerFixtures();
  return [
    { id: 'integrations-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

