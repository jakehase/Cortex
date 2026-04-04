import { buildAnalyticsConsoleSnapshot } from '../service-analytics-console.mjs';
import { createAnalyticsConsoleFixtures } from '../fixtures-analytics-console.mjs';

export function createAnalyticsConsolePublicRoutes(basePath = '/public/analytics-console') {
  const snapshot = buildAnalyticsConsoleSnapshot();
  const fixtures = createAnalyticsConsoleFixtures();
  return [
    { id: 'analytics-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

