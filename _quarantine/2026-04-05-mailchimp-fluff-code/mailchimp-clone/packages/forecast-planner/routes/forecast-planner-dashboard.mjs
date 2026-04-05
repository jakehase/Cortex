import { buildForecastPlannerSnapshot } from '../service-forecast-planner.mjs';

export function createForecastPlannerDashboardRoutes(basePath = '/forecast-planner') {
  const snapshot = buildForecastPlannerSnapshot();
  return [
    { id: 'forecast-planner.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'forecast-planner.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'forecast-planner.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
