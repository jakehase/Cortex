import { buildDataScorecardSnapshot } from '../service-data-scorecard.mjs';
import { createDataScorecardFixtures } from '../fixtures-data-scorecard.mjs';

export function createDataScorecardPublicRoutes(basePath = '/public/data-scorecard') {
  const snapshot = buildDataScorecardSnapshot();
  const fixtures = createDataScorecardFixtures();
  return [
    { id: 'data-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

