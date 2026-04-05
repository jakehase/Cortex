import { buildAnalyticsCockpitSnapshot } from '../service-analytics-cockpit.mjs';
import { createAnalyticsCockpitFixtures } from '../fixtures-analytics-cockpit.mjs';

export function createAnalyticsCockpitPublicRoutes(basePath = '/public/analytics-cockpit') {
  const snapshot = buildAnalyticsCockpitSnapshot();
  const fixtures = createAnalyticsCockpitFixtures();
  return [
    { id: 'analytics-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

