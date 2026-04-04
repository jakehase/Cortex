import { buildInsightsWatchtowerSnapshot } from '../service-insights-watchtower.mjs';
import { createInsightsWatchtowerFixtures } from '../fixtures-insights-watchtower.mjs';

export function createInsightsWatchtowerPublicRoutes(basePath = '/public/insights-watchtower') {
  const snapshot = buildInsightsWatchtowerSnapshot();
  const fixtures = createInsightsWatchtowerFixtures();
  return [
    { id: 'insights-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

