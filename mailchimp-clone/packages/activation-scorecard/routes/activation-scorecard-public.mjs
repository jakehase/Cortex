import { buildActivationScorecardSnapshot } from '../service-activation-scorecard.mjs';
import { createActivationScorecardFixtures } from '../fixtures-activation-scorecard.mjs';

export function createActivationScorecardPublicRoutes(basePath = '/public/activation-scorecard') {
  const snapshot = buildActivationScorecardSnapshot();
  const fixtures = createActivationScorecardFixtures();
  return [
    { id: 'activation-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

