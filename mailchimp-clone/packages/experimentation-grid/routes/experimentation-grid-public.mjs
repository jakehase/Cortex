import { buildExperimentationGridSnapshot } from '../service-experimentation-grid.mjs';
import { createExperimentationGridFixtures } from '../fixtures-experimentation-grid.mjs';

export function createExperimentationGridPublicRoutes(basePath = '/public/experimentation-grid') {
  const snapshot = buildExperimentationGridSnapshot();
  const fixtures = createExperimentationGridFixtures();
  return [
    { id: 'experimentation-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

