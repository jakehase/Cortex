import { buildExperimentationCockpitSnapshot } from '../service-experimentation-cockpit.mjs';
import { createExperimentationCockpitFixtures } from '../fixtures-experimentation-cockpit.mjs';

export function createExperimentationCockpitPublicRoutes(basePath = '/public/experimentation-cockpit') {
  const snapshot = buildExperimentationCockpitSnapshot();
  const fixtures = createExperimentationCockpitFixtures();
  return [
    { id: 'experimentation-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

