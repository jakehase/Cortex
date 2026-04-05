import { buildExperimentationHubSnapshot } from '../service-experimentation-hub.mjs';
import { createExperimentationHubFixtures } from '../fixtures-experimentation-hub.mjs';

export function createExperimentationHubPublicRoutes(basePath = '/public/experimentation-hub') {
  const snapshot = buildExperimentationHubSnapshot();
  const fixtures = createExperimentationHubFixtures();
  return [
    { id: 'experimentation-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

