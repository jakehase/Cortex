import { buildAnalyticsFoundrySnapshot } from '../service-analytics-foundry.mjs';
import { createAnalyticsFoundryFixtures } from '../fixtures-analytics-foundry.mjs';

export function createAnalyticsFoundryPublicRoutes(basePath = '/public/analytics-foundry') {
  const snapshot = buildAnalyticsFoundrySnapshot();
  const fixtures = createAnalyticsFoundryFixtures();
  return [
    { id: 'analytics-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

