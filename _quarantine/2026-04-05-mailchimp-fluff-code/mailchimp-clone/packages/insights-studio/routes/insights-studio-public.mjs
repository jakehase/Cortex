import { buildInsightsStudioSnapshot } from '../service-insights-studio.mjs';
import { createInsightsStudioFixtures } from '../fixtures-insights-studio.mjs';

export function createInsightsStudioPublicRoutes(basePath = '/public/insights-studio') {
  const snapshot = buildInsightsStudioSnapshot();
  const fixtures = createInsightsStudioFixtures();
  return [
    { id: 'insights-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

