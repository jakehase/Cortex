import { buildAnalyticsPlannerSnapshot } from '../service-analytics-planner.mjs';
import { createAnalyticsPlannerFixtures } from '../fixtures-analytics-planner.mjs';

export function createAnalyticsPlannerPublicRoutes(basePath = '/public/analytics-planner') {
  const snapshot = buildAnalyticsPlannerSnapshot();
  const fixtures = createAnalyticsPlannerFixtures();
  return [
    { id: 'analytics-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-planner.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

