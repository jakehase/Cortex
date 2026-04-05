import { buildAnalyticsWatchtowerSnapshot } from '../service-analytics-watchtower.mjs';
import { createAnalyticsWatchtowerFixtures } from '../fixtures-analytics-watchtower.mjs';

export function createAnalyticsWatchtowerPublicRoutes(basePath = '/public/analytics-watchtower') {
  const snapshot = buildAnalyticsWatchtowerSnapshot();
  const fixtures = createAnalyticsWatchtowerFixtures();
  return [
    { id: 'analytics-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

