import { buildAnalyticsGridSnapshot } from '../service-analytics-grid.mjs';
import { createAnalyticsGridFixtures } from '../fixtures-analytics-grid.mjs';

export function createAnalyticsGridPublicRoutes(basePath = '/public/analytics-grid') {
  const snapshot = buildAnalyticsGridSnapshot();
  const fixtures = createAnalyticsGridFixtures();
  return [
    { id: 'analytics-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

