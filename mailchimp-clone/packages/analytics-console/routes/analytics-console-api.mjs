import { buildAnalyticsConsoleSnapshot, createAnalyticsConsoleApiDocument } from '../service-analytics-console.mjs';

export function createAnalyticsConsoleApiRoutes(basePath = '/api/analytics-console') {
  const snapshot = buildAnalyticsConsoleSnapshot();
  return [
    { id: 'analytics-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'analytics-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'analytics-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'analytics-console.api.document', method: 'GET', path: basePath + '/document', document: createAnalyticsConsoleApiDocument(snapshot) }
  ];
}

