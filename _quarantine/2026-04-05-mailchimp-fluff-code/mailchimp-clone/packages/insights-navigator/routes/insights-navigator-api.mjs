import { buildInsightsNavigatorSnapshot, createInsightsNavigatorApiDocument } from '../service-insights-navigator.mjs';

export function createInsightsNavigatorApiRoutes(basePath = '/api/insights-navigator') {
  const snapshot = buildInsightsNavigatorSnapshot();
  return [
    { id: 'insights-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-navigator.api.document', method: 'GET', path: basePath + '/document', document: createInsightsNavigatorApiDocument(snapshot) }
  ];
}

