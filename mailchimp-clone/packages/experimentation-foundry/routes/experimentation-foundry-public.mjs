import { buildExperimentationFoundrySnapshot } from '../service-experimentation-foundry.mjs';
import { createExperimentationFoundryFixtures } from '../fixtures-experimentation-foundry.mjs';

export function createExperimentationFoundryPublicRoutes(basePath = '/public/experimentation-foundry') {
  const snapshot = buildExperimentationFoundrySnapshot();
  const fixtures = createExperimentationFoundryFixtures();
  return [
    { id: 'experimentation-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

