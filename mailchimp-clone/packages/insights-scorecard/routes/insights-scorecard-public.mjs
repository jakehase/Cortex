import { buildInsightsScorecardSnapshot } from '../service-insights-scorecard.mjs';
import { createInsightsScorecardFixtures } from '../fixtures-insights-scorecard.mjs';

export function createInsightsScorecardPublicRoutes(basePath = '/public/insights-scorecard') {
  const snapshot = buildInsightsScorecardSnapshot();
  const fixtures = createInsightsScorecardFixtures();
  return [
    { id: 'insights-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

