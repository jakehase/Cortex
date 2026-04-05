import { buildForecastPlannerSnapshot, createForecastPlannerApiDocument } from '../service-forecast-planner.mjs';

export function createForecastPlannerApiRoutes(basePath = '/api/forecast-planner') {
  const snapshot = buildForecastPlannerSnapshot();
  return [
    { id: 'forecast-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'forecast-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'forecast-planner.api.document', method: 'GET', path: basePath + '/document', document: createForecastPlannerApiDocument(snapshot) }
  ];
}
