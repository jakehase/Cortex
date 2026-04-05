import { buildAcquisitionPlannerSnapshot } from '../service-acquisition-planner.mjs';
import { createAcquisitionPlannerFixtures } from '../fixtures-acquisition-planner.mjs';

export function createAcquisitionPlannerPublicRoutes(basePath = '/public/acquisition-planner') {
  const snapshot = buildAcquisitionPlannerSnapshot();
  const fixtures = createAcquisitionPlannerFixtures();
  return [
    { id: 'acquisition-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

