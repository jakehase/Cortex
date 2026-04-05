import { buildAnalyticsScorecardSnapshot } from '../service-analytics-scorecard.mjs';
import { createAnalyticsScorecardFixtures } from '../fixtures-analytics-scorecard.mjs';

export function createAnalyticsScorecardPublicRoutes(basePath = '/public/analytics-scorecard') {
  const snapshot = buildAnalyticsScorecardSnapshot();
  const fixtures = createAnalyticsScorecardFixtures();
  return [
    { id: 'analytics-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

