import { buildExperimentationNavigatorSnapshot } from '../service-experimentation-navigator.mjs';
import { createExperimentationNavigatorFixtures } from '../fixtures-experimentation-navigator.mjs';

export function createExperimentationNavigatorPublicRoutes(basePath = '/public/experimentation-navigator') {
  const snapshot = buildExperimentationNavigatorSnapshot();
  const fixtures = createExperimentationNavigatorFixtures();
  return [
    { id: 'experimentation-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

