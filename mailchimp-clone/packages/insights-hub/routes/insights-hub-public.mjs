import { buildInsightsHubSnapshot } from '../service-insights-hub.mjs';
import { createInsightsHubFixtures } from '../fixtures-insights-hub.mjs';

export function createInsightsHubPublicRoutes(basePath = '/public/insights-hub') {
  const snapshot = buildInsightsHubSnapshot();
  const fixtures = createInsightsHubFixtures();
  return [
    { id: 'insights-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

