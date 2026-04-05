import { buildForecastPlannerSnapshot, createForecastPlannerChecklist } from '../service-forecast-planner.mjs';

export function createForecastPlannerOpsRoutes(basePath = '/ops/forecast-planner') {
  const snapshot = buildForecastPlannerSnapshot();
  return [
    { id: 'forecast-planner.ops.health', method: 'GET', path: basePath + '/health', checklist: createForecastPlannerChecklist(snapshot) },
    { id: 'forecast-planner.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'forecast-planner.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
