import { buildLoyaltyScorecardSnapshot } from '../service-loyalty-scorecard.mjs';
import { createLoyaltyScorecardFixtures } from '../fixtures-loyalty-scorecard.mjs';

export function createLoyaltyScorecardPublicRoutes(basePath = '/public/loyalty-scorecard') {
  const snapshot = buildLoyaltyScorecardSnapshot();
  const fixtures = createLoyaltyScorecardFixtures();
  return [
    { id: 'loyalty-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

