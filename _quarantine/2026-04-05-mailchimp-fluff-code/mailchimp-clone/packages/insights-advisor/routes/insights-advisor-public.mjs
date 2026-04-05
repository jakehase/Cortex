import { buildInsightsAdvisorSnapshot } from '../service-insights-advisor.mjs';
import { createInsightsAdvisorFixtures } from '../fixtures-insights-advisor.mjs';

export function createInsightsAdvisorPublicRoutes(basePath = '/public/insights-advisor') {
  const snapshot = buildInsightsAdvisorSnapshot();
  const fixtures = createInsightsAdvisorFixtures();
  return [
    { id: 'insights-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

