import { buildAnalyticsStudioSnapshot } from '../service-analytics-studio.mjs';
import { createAnalyticsStudioFixtures } from '../fixtures-analytics-studio.mjs';

export function createAnalyticsStudioPublicRoutes(basePath = '/public/analytics-studio') {
  const snapshot = buildAnalyticsStudioSnapshot();
  const fixtures = createAnalyticsStudioFixtures();
  return [
    { id: 'analytics-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

