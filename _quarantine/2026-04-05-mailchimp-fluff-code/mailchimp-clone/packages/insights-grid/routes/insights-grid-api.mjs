import { buildInsightsGridSnapshot, createInsightsGridApiDocument } from '../service-insights-grid.mjs';

export function createInsightsGridApiRoutes(basePath = '/api/insights-grid') {
  const snapshot = buildInsightsGridSnapshot();
  return [
    { id: 'insights-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'insights-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'insights-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'insights-grid.api.document', method: 'GET', path: basePath + '/document', document: createInsightsGridApiDocument(snapshot) }
  ];
}

