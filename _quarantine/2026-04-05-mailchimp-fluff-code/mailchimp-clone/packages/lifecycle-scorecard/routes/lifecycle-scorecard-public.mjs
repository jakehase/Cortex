import { buildLifecycleScorecardSnapshot } from '../service-lifecycle-scorecard.mjs';
import { createLifecycleScorecardFixtures } from '../fixtures-lifecycle-scorecard.mjs';

export function createLifecycleScorecardPublicRoutes(basePath = '/public/lifecycle-scorecard') {
  const snapshot = buildLifecycleScorecardSnapshot();
  const fixtures = createLifecycleScorecardFixtures();
  return [
    { id: 'lifecycle-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

