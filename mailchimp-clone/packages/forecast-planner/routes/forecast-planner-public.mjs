import { buildForecastPlannerSnapshot } from '../service-forecast-planner.mjs';
import { createForecastPlannerFixtures } from '../fixtures-forecast-planner.mjs';

export function createForecastPlannerPublicRoutes(basePath = '/public/forecast-planner') {
  const snapshot = buildForecastPlannerSnapshot();
  const fixtures = createForecastPlannerFixtures();
  return [
    { id: 'forecast-planner.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'forecast-planner.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'forecast-planner.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
