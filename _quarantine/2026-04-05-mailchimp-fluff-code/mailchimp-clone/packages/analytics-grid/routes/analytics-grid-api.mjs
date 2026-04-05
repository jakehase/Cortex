import { buildAnalyticsGridSnapshot, createAnalyticsGridApiDocument } from '../service-analytics-grid.mjs';

export function createAnalyticsGridApiRoutes(basePath = '/api/analytics-grid') {
  const snapshot = buildAnalyticsGridSnapshot();
  return [
    { id: 'analytics-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-grid.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsGridApiDocument(snapshot) }
  ];
}

