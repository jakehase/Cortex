import { buildExperimentationAdvisorSnapshot } from '../service-experimentation-advisor.mjs';
import { createExperimentationAdvisorFixtures } from '../fixtures-experimentation-advisor.mjs';

export function createExperimentationAdvisorPublicRoutes(basePath = '/public/experimentation-advisor') {
  const snapshot = buildExperimentationAdvisorSnapshot();
  const fixtures = createExperimentationAdvisorFixtures();
  return [
    { id: 'experimentation-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

