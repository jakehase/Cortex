import { buildExperimentationExchangeSnapshot } from '../service-experimentation-exchange.mjs';
import { createExperimentationExchangeFixtures } from '../fixtures-experimentation-exchange.mjs';

export function createExperimentationExchangePublicRoutes(basePath = '/public/experimentation-exchange') {
  const snapshot = buildExperimentationExchangeSnapshot();
  const fixtures = createExperimentationExchangeFixtures();
  return [
    { id: 'experimentation-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'experimentation-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'experimentation-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

