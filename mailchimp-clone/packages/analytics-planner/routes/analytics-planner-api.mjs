import { buildAnalyticsPlannerSnapshot, createAnalyticsPlannerApiDocument } from '../service-analytics-planner.mjs';

export function createAnalyticsPlannerApiRoutes(basePath = '/api/analytics-planner') {
  const snapshot = buildAnalyticsPlannerSnapshot();
  return [
    { id: 'analytics-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-planner.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsPlannerApiDocument(snapshot) }
  ];
}

