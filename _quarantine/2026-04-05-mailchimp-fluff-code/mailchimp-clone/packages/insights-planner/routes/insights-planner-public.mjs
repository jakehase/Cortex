import { buildInsightsPlannerSnapshot } from '../service-insights-planner.mjs';
import { createInsightsPlannerFixtures } from '../fixtures-insights-planner.mjs';

export function createInsightsPlannerPublicRoutes(basePath = '/public/insights-planner') {
  const snapshot = buildInsightsPlannerSnapshot();
  const fixtures = createInsightsPlannerFixtures();
  return [
    { id: 'insights-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

