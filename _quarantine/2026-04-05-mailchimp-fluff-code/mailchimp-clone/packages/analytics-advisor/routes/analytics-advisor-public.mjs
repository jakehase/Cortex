import { buildAnalyticsAdvisorSnapshot } from '../service-analytics-advisor.mjs';
import { createAnalyticsAdvisorFixtures } from '../fixtures-analytics-advisor.mjs';

export function createAnalyticsAdvisorPublicRoutes(basePath = '/public/analytics-advisor') {
  const snapshot = buildAnalyticsAdvisorSnapshot();
  const fixtures = createAnalyticsAdvisorFixtures();
  return [
    { id: 'analytics-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

