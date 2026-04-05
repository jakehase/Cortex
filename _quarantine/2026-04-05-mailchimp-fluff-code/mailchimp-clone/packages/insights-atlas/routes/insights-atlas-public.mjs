import { buildInsightsAtlasSnapshot } from '../service-insights-atlas.mjs';
import { createInsightsAtlasFixtures } from '../fixtures-insights-atlas.mjs';

export function createInsightsAtlasPublicRoutes(basePath = '/public/insights-atlas') {
  const snapshot = buildInsightsAtlasSnapshot();
  const fixtures = createInsightsAtlasFixtures();
  return [
    { id: 'insights-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

