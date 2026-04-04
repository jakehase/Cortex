import { buildExperimentationStudioSnapshot } from '../service-experimentation-studio.mjs';
import { createExperimentationStudioFixtures } from '../fixtures-experimentation-studio.mjs';

export function createExperimentationStudioPublicRoutes(basePath = '/public/experimentation-studio') {
  const snapshot = buildExperimentationStudioSnapshot();
  const fixtures = createExperimentationStudioFixtures();
  return [
    { id: 'experimentation-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

