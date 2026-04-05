import { buildAnalyticsHubSnapshot } from '../service-analytics-hub.mjs';
import { createAnalyticsHubFixtures } from '../fixtures-analytics-hub.mjs';

export function createAnalyticsHubPublicRoutes(basePath = '/public/analytics-hub') {
  const snapshot = buildAnalyticsHubSnapshot();
  const fixtures = createAnalyticsHubFixtures();
  return [
    { id: 'analytics-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

