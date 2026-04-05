import { buildExperimentationWatchtowerSnapshot } from '../service-experimentation-watchtower.mjs';
import { createExperimentationWatchtowerFixtures } from '../fixtures-experimentation-watchtower.mjs';

export function createExperimentationWatchtowerPublicRoutes(basePath = '/public/experimentation-watchtower') {
  const snapshot = buildExperimentationWatchtowerSnapshot();
  const fixtures = createExperimentationWatchtowerFixtures();
  return [
    { id: 'experimentation-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

