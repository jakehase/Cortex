import { buildAnalyticsAtlasSnapshot } from '../service-analytics-atlas.mjs';
import { createAnalyticsAtlasFixtures } from '../fixtures-analytics-atlas.mjs';

export function createAnalyticsAtlasPublicRoutes(basePath = '/public/analytics-atlas') {
  const snapshot = buildAnalyticsAtlasSnapshot();
  const fixtures = createAnalyticsAtlasFixtures();
  return [
    { id: 'analytics-atlas.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-atlas.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-atlas.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

