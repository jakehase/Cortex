import { buildAnalyticsHubSnapshot, createAnalyticsHubApiDocument } from '../service-analytics-hub.mjs';

export function createAnalyticsHubApiRoutes(basePath = '/api/analytics-hub') {
  const snapshot = buildAnalyticsHubSnapshot();
  return [
    { id: 'analytics-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-hub.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsHubApiDocument(snapshot) }
  ];
}

