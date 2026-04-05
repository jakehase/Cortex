import { buildAnalyticsIndexSnapshot } from '../service-analytics-index.mjs';
import { createAnalyticsIndexFixtures } from '../fixtures-analytics-index.mjs';

export function createAnalyticsIndexPublicRoutes(basePath = '/public/analytics-index') {
  const snapshot = buildAnalyticsIndexSnapshot();
  const fixtures = createAnalyticsIndexFixtures();
  return [
    { id: 'analytics-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

