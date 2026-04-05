import { buildExperimentationIndexSnapshot } from '../service-experimentation-index.mjs';
import { createExperimentationIndexFixtures } from '../fixtures-experimentation-index.mjs';

export function createExperimentationIndexPublicRoutes(basePath = '/public/experimentation-index') {
  const snapshot = buildExperimentationIndexSnapshot();
  const fixtures = createExperimentationIndexFixtures();
  return [
    { id: 'experimentation-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

