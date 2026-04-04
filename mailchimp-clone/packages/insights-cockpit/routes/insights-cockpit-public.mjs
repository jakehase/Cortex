import { buildInsightsCockpitSnapshot } from '../service-insights-cockpit.mjs';
import { createInsightsCockpitFixtures } from '../fixtures-insights-cockpit.mjs';

export function createInsightsCockpitPublicRoutes(basePath = '/public/insights-cockpit') {
  const snapshot = buildInsightsCockpitSnapshot();
  const fixtures = createInsightsCockpitFixtures();
  return [
    { id: 'insights-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

