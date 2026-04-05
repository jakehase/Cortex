import { buildAnalyticsIndexSnapshot, createAnalyticsIndexApiDocument } from '../service-analytics-index.mjs';

export function createAnalyticsIndexApiRoutes(basePath = '/api/analytics-index') {
  const snapshot = buildAnalyticsIndexSnapshot();
  return [
    { id: 'analytics-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-index.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsIndexApiDocument(snapshot) }
  ];
}

