import { buildAttributionScorecardSnapshot } from '../service-attribution-scorecard.mjs';
import { createAttributionScorecardFixtures } from '../fixtures-attribution-scorecard.mjs';

export function createAttributionScorecardPublicRoutes(basePath = '/public/attribution-scorecard') {
  const snapshot = buildAttributionScorecardSnapshot();
  const fixtures = createAttributionScorecardFixtures();
  return [
    { id: 'attribution-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

