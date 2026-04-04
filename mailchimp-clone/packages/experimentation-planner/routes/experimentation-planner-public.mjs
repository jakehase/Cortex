import { buildExperimentationPlannerSnapshot } from '../service-experimentation-planner.mjs';
import { createExperimentationPlannerFixtures } from '../fixtures-experimentation-planner.mjs';

export function createExperimentationPlannerPublicRoutes(basePath = '/public/experimentation-planner') {
  const snapshot = buildExperimentationPlannerSnapshot();
  const fixtures = createExperimentationPlannerFixtures();
  return [
    { id: 'experimentation-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

