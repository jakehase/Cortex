import { buildAnalyticsNavigatorSnapshot } from '../service-analytics-navigator.mjs';
import { createAnalyticsNavigatorFixtures } from '../fixtures-analytics-navigator.mjs';

export function createAnalyticsNavigatorPublicRoutes(basePath = '/public/analytics-navigator') {
  const snapshot = buildAnalyticsNavigatorSnapshot();
  const fixtures = createAnalyticsNavigatorFixtures();
  return [
    { id: 'analytics-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

