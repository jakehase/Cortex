import { buildInsightsNavigatorSnapshot } from '../service-insights-navigator.mjs';
import { createInsightsNavigatorFixtures } from '../fixtures-insights-navigator.mjs';

export function createInsightsNavigatorPublicRoutes(basePath = '/public/insights-navigator') {
  const snapshot = buildInsightsNavigatorSnapshot();
  const fixtures = createInsightsNavigatorFixtures();
  return [
    { id: 'insights-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

