import { buildAdvocacyScorecardSnapshot } from '../service-advocacy-scorecard.mjs';
import { createAdvocacyScorecardFixtures } from '../fixtures-advocacy-scorecard.mjs';

export function createAdvocacyScorecardPublicRoutes(basePath = '/public/advocacy-scorecard') {
  const snapshot = buildAdvocacyScorecardSnapshot();
  const fixtures = createAdvocacyScorecardFixtures();
  return [
    { id: 'advocacy-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

