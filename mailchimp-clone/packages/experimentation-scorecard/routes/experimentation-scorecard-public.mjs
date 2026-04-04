import { buildExperimentationScorecardSnapshot } from '../service-experimentation-scorecard.mjs';
import { createExperimentationScorecardFixtures } from '../fixtures-experimentation-scorecard.mjs';

export function createExperimentationScorecardPublicRoutes(basePath = '/public/experimentation-scorecard') {
  const snapshot = buildExperimentationScorecardSnapshot();
  const fixtures = createExperimentationScorecardFixtures();
  return [
    { id: 'experimentation-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

