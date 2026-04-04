import { buildAudiencePlannerSnapshot } from '../service-audience-planner.mjs';
import { createAudiencePlannerFixtures } from '../fixtures-audience-planner.mjs';

export function createAudiencePlannerPublicRoutes(basePath = '/public/audience-planner') {
  const snapshot = buildAudiencePlannerSnapshot();
  const fixtures = createAudiencePlannerFixtures();
  return [
    { id: 'audience-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

