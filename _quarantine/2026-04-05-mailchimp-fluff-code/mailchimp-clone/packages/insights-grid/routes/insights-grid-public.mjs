import { buildInsightsGridSnapshot } from '../service-insights-grid.mjs';
import { createInsightsGridFixtures } from '../fixtures-insights-grid.mjs';

export function createInsightsGridPublicRoutes(basePath = '/public/insights-grid') {
  const snapshot = buildInsightsGridSnapshot();
  const fixtures = createInsightsGridFixtures();
  return [
    { id: 'insights-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

