import { buildInsightsIndexSnapshot } from '../service-insights-index.mjs';
import { createInsightsIndexFixtures } from '../fixtures-insights-index.mjs';

export function createInsightsIndexPublicRoutes(basePath = '/public/insights-index') {
  const snapshot = buildInsightsIndexSnapshot();
  const fixtures = createInsightsIndexFixtures();
  return [
    { id: 'insights-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

