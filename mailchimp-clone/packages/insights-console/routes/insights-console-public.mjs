import { buildInsightsConsoleSnapshot } from '../service-insights-console.mjs';
import { createInsightsConsoleFixtures } from '../fixtures-insights-console.mjs';

export function createInsightsConsolePublicRoutes(basePath = '/public/insights-console') {
  const snapshot = buildInsightsConsoleSnapshot();
  const fixtures = createInsightsConsoleFixtures();
  return [
    { id: 'insights-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

