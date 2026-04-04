import { buildExperimentationConsoleSnapshot } from '../service-experimentation-console.mjs';
import { createExperimentationConsoleFixtures } from '../fixtures-experimentation-console.mjs';

export function createExperimentationConsolePublicRoutes(basePath = '/public/experimentation-console') {
  const snapshot = buildExperimentationConsoleSnapshot();
  const fixtures = createExperimentationConsoleFixtures();
  return [
    { id: 'experimentation-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

