import { buildInsightsPlannerSnapshot, createInsightsPlannerApiDocument } from '../service-insights-planner.mjs';

export function createInsightsPlannerApiRoutes(basePath = '/api/insights-planner') {
  const snapshot = buildInsightsPlannerSnapshot();
  return [
    { id: 'insights-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-planner.api.document', method: 'GET', path: basePath + '/document', document: createInsightsPlannerApiDocument(snapshot) }
  ];
}

